import React, { useRef, useState, useEffect } from 'react';
import { get_tables_live, create_table_live, delete_table_live, open_table_live, pay_table_live, transfer_table_live, merge_tables_live, revise_table_items_live } from '../api/tables';
import { get_kitchen_orders_live } from '../api/kds';
import { LayoutGrid, Plus, Trash2, ArrowRightCircle } from 'lucide-react';
import { useAppStore } from '../store';
import { tx } from '../i18n';
import ConfirmModal from './ConfirmModal';
import { Decimal } from 'decimal.js';
import { get_business_profile, get_settings } from '../api/settings';
import { getDB } from '../lib/db_sim';
import { qzPrintHtml } from '../lib/qz';

export default function TablesPage() {
  const [tables, setTables] = useState<any[]>([]);
  const [kitchenOrders, setKitchenOrders] = useState<any[]>([]);
  const { user, lang, notify } = useAppStore();
  const tenant_id = user?.tenant_id || 'tenant_default';
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [newTableName, setNewTableName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTableId, setDeleteTableId] = useState<string | null>(null);
  const [openTableId, setOpenTableId] = useState<string | null>(null);
  const [guestCount, setGuestCount] = useState('1');
  const [depositSelections, setDepositSelections] = useState<boolean[]>([false]);
  const [showDeleteAuth, setShowDeleteAuth] = useState(false);
  const [deleteAdminPass, setDeleteAdminPass] = useState('');
  const [payTableId, setPayTableId] = useState<string | null>(null);
  const [viewTableId, setViewTableId] = useState<string | null>(null);
  const [transferTargetId, setTransferTargetId] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [tableReceiptHtml, setTableReceiptHtml] = useState<string | null>(null);
  const [revisionTarget, setRevisionTarget] = useState<{ tableId: string; itemName: string; nextItems: any[] } | null>(null);
  const [revisionReason, setRevisionReason] = useState('');
  const [revisionOverridePassword, setRevisionOverridePassword] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'Nəğd' | 'Kart' | 'Split'>('Nəğd');
  const [splitCash, setSplitCash] = useState('0');
  const [splitCount, setSplitCount] = useState('2');
  const [splitParts, setSplitParts] = useState<Array<{ amount: string; method: 'Nəğd' | 'Kart' }>>([]);
  const receiptRef = useRef<HTMLIFrameElement | null>(null);
  const businessProfile = get_business_profile(tenant_id);
  const tenantSettings = get_settings(tenant_id);
  const printSettings = tenantSettings.print_settings || { use_qz: false, printer_name: '' };
  const depositPerGuest = new Decimal((tenantSettings as any).table_service_settings?.deposit_per_guest_azn || 0);
  const serviceFeePercent = new Decimal(tenantSettings.service_fee_percent || 0);

  const formatDisplayId = (id: string) => (id ? id.split('-')[0].toUpperCase() : '-');
  const deriveConfiguredSeatLabels = (table: any) => Array.from({ length: Math.max(1, Number(table?.guest_count || 1)) }, (_, idx) => `Adam-${idx + 1}`);
  const deriveDepositSeatLabels = (table: any) => {
    const explicit = Array.isArray(table?.deposit_seat_labels) ? table.deposit_seat_labels.map((label: any) => String(label || '').trim()).filter(Boolean) : [];
    if (explicit.length > 0) return explicit;
    return deriveConfiguredSeatLabels(table).slice(0, Math.max(0, Number(table?.deposit_guest_count || 0)));
  };
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

  useEffect(() => {
    const count = Math.max(1, Number(guestCount || 1));
    setDepositSelections((prev) => Array.from({ length: count }, (_, idx) => Boolean(prev[idx])));
  }, [guestCount]);

  const loadData = async () => {
    const [nextTables, nextKitchenOrders] = await Promise.all([
      get_tables_live(tenant_id),
      get_kitchen_orders_live(tenant_id),
    ]);
    setTables(nextTables);
    setKitchenOrders(Array.isArray(nextKitchenOrders) ? nextKitchenOrders : []);
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

  const handleOpenTable = async () => {
    if (!openTableId) return;
    const normalizedGuestCount = Math.max(1, Number(guestCount || 1));
    const depositSeatLabels = Array.from({ length: normalizedGuestCount }, (_, idx) => idx)
      .filter((idx) => Boolean(depositSelections[idx]))
      .map((idx) => `Adam-${idx + 1}`);
    const depositGuestCount = depositSeatLabels.length;
    try {
      await open_table_live(openTableId, {
        guest_count: normalizedGuestCount,
        deposit_guest_count: depositGuestCount,
        deposit_seat_labels: depositSeatLabels,
        opened_by: user?.username || 'staff',
      });
      notify(
        'success',
        tx(lang, 'Masa açıldı', 'Стол открыт', 'Table opened'),
      );
      const currentTableId = openTableId;
      setOpenTableId(null);
      setGuestCount('1');
      setDepositSelections([false]);
      await loadData();
      setViewTableId(currentTableId);
    } catch (e: any) {
      notify('error', tx(lang, 'Xəta: ', 'Ошибка: ', 'Error: ') + e.message);
    }
  };

  const handleDeleteTable = async (id: string) => {
    try {
      await delete_table_live(id, user?.username || 'Staff');
      notify('success', tx(lang, 'Masa silindi', 'Стол удален', 'Table deleted'));
      setDeleteTableId(null);
      await loadData();
    } catch(e:any) { notify('error', tx(lang, 'Xəta: ', 'Ошибка: ', 'Error: ') + e.message); }
  };

  const openTableInPos = (table: any) => {
    sessionStorage.setItem(
      `${tenant_id}_open_table_in_pos`,
      JSON.stringify({
        table_id: table.id,
        table_label: table.label,
      }),
    );
    window.dispatchEvent(new CustomEvent('open-table-in-pos', {
      detail: {
        table_id: table.id,
        table_label: table.label,
      },
    }));
    setViewTableId(null);
  };

  const buildEqualSplitParts = (count: number, total: Decimal) => {
    if (count <= 0) return [];
    const safeTotal = total.toDecimalPlaces(2);
    const base = safeTotal.div(count).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    let remainder = safeTotal.minus(base.times(count)).toDecimalPlaces(2);
    return Array.from({ length: count }, (_, idx) => {
      const extra = remainder.greaterThan(0) ? new Decimal('0.01') : new Decimal(0);
      remainder = Decimal.max(new Decimal(0), remainder.minus(extra));
      return {
        amount: base.plus(extra).toFixed(2),
        method: idx === 0 ? 'Nəğd' : 'Kart',
      } as { amount: string; method: 'Nəğd' | 'Kart' };
    });
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

      {revisionTarget && (
        <div className="fixed inset-0 z-[145] flex items-center justify-center bg-black/70 p-4">
          <div className="metal-panel w-full max-w-md p-5">
            <h3 className="text-lg font-bold text-slate-100">{tx(lang, 'Manager/Admin Təsdiqi', 'Подтверждение manager/admin', 'Manager/Admin Override')}</h3>
            <p className="mt-2 text-sm text-slate-300">
              {tx(lang, `"${revisionTarget.itemName}" mətbəxə göndərilib. Dəyişiklik üçün manager/admin şifrəsi və səbəb lazımdır.`, `"${revisionTarget.itemName}" уже отправлен на кухню. Для изменения нужны пароль manager/admin и причина.`, `"${revisionTarget.itemName}" was already sent to the kitchen. Manager/admin password and reason are required to change it.`)}
            </p>
            <input
              className="neon-input mt-3"
              value={revisionReason}
              onChange={(e) => setRevisionReason(e.target.value)}
              placeholder={tx(lang, 'Səbəb', 'Причина', 'Reason')}
            />
            <input
              type="password"
              className="neon-input mt-3"
              value={revisionOverridePassword}
              onChange={(e) => setRevisionOverridePassword(e.target.value)}
              placeholder={tx(lang, 'Manager/Admin şifrəsi', 'Пароль manager/admin', 'Manager/Admin password')}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="neon-btn rounded-lg px-4 py-2"
                onClick={() => {
                  setRevisionTarget(null);
                  setRevisionReason('');
                  setRevisionOverridePassword('');
                }}
              >
                {tx(lang, 'Ləğv et', 'Отмена', 'Cancel')}
              </button>
              <button
                className="glossy-gold rounded-lg px-4 py-2 font-semibold"
                onClick={async () => {
                  if (!revisionTarget) return;
                  try {
                    await revise_table_items_live(revisionTarget.tableId, {
                      items: revisionTarget.nextItems,
                      reason: revisionReason,
                      override_password: revisionOverridePassword,
                      actor: user?.username || 'staff',
                    });
                    notify('success', tx(lang, 'Düzəliş mətbəx reviziyası ilə yazıldı', 'Изменение записано как ревизия кухни', 'Change was written as a kitchen revision'));
                    setRevisionTarget(null);
                    setRevisionReason('');
                    setRevisionOverridePassword('');
                    await loadData();
                  } catch (e: any) {
                    notify('error', e?.message || tx(lang, 'Düzəliş alınmadı', 'Изменение не выполнено', 'Revision failed'));
                  }
                }}
              >
                {tx(lang, 'Təsdiqlə', 'Подтвердить', 'Confirm')}
              </button>
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
                const payItems = Array.isArray(t.items) ? t.items : [];
                const itemsTotal = payItems.reduce((acc: Decimal, row: any) => acc.plus(new Decimal(row.price || 0).times(row.qty || 0)), new Decimal(0));
                const serviceFee = itemsTotal.times(serviceFeePercent).div(100).toDecimalPlaces(2);
                const deposit = new Decimal(t.deposit_amount || 0);
                const finalTotal = Decimal.max(itemsTotal.plus(serviceFee), deposit).toDecimalPlaces(2);
                const extraDue = Decimal.max(new Decimal(0), finalTotal.minus(deposit)).toDecimalPlaces(2);
                return `${t.label} - ${finalTotal.toFixed(2)} ₼ (${tx(lang, 'əlavə ödəniş', 'доплата', 'extra due')}: ${extraDue.toFixed(2)} ₼)`;
              })()}
            </div>
              {(() => {
                const t = tables.find((x) => x.id === payTableId);
                if (!t) return null;
                const payItems = Array.isArray(t.items) ? t.items : [];
                const itemsTotal = payItems.reduce((acc: Decimal, row: any) => acc.plus(new Decimal(row.price || 0).times(row.qty || 0)), new Decimal(0));
                const serviceFee = itemsTotal.times(serviceFeePercent).div(100).toDecimalPlaces(2);
                const deposit = new Decimal(t.deposit_amount || 0);
                const finalTotal = Decimal.max(itemsTotal.plus(serviceFee), deposit).toDecimalPlaces(2);
                const extraDue = Decimal.max(new Decimal(0), finalTotal.minus(deposit)).toDecimalPlaces(2);
                return (
                <div className="mt-3 rounded-xl border border-slate-700/60 bg-slate-950/30 p-3 text-sm text-slate-300">
                  <div className="flex justify-between"><span>{tx(lang, 'Sifariş cəmi', 'Сумма заказа', 'Items total')}</span><span>{itemsTotal.toFixed(2)} ₼</span></div>
                  <div className="mt-1 flex justify-between"><span>{tx(lang, 'Servis haqqı', 'Сервисный сбор', 'Service fee')}</span><span>{serviceFee.toFixed(2)} ₼</span></div>
                  <div className="mt-1 flex justify-between"><span>{tx(lang, 'Depozit', 'Депозит', 'Deposit')}</span><span>{deposit.toFixed(2)} ₼</span></div>
                  <div className="mt-1 flex justify-between font-semibold text-slate-100"><span>{tx(lang, 'Yekun hesab', 'Итоговый счет', 'Final bill')}</span><span>{finalTotal.toFixed(2)} ₼</span></div>
                  <div className="mt-1 flex justify-between text-emerald-200"><span>{tx(lang, 'Hazırda alınacaq', 'К оплате сейчас', 'Due now')}</span><span>{extraDue.toFixed(2)} ₼</span></div>
                </div>
              );
            })()}
            <div className="mt-4 grid grid-cols-3 gap-2">
              {(['Nəğd', 'Kart', 'Split'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setPaymentMethod(m);
                    if (m === 'Split') {
                      const table = tables.find((x) => x.id === payTableId);
                      if (table) {
                        const itemsSnapshot = Array.isArray(table.items) ? [...table.items] : [];
                        const itemsTotal = itemsSnapshot.reduce((acc: Decimal, row: any) => acc.plus(new Decimal(row.price || 0).times(row.qty || 0)), new Decimal(0));
                        const serviceFee = itemsTotal.times(serviceFeePercent).div(100).toDecimalPlaces(2);
                        const deposit = new Decimal(table.deposit_amount || 0);
                        const finalTotal = Decimal.max(itemsTotal.plus(serviceFee), deposit).toDecimalPlaces(2);
                        const dueNow = Decimal.max(new Decimal(0), finalTotal.minus(deposit)).toDecimalPlaces(2);
                        const count = Math.max(2, Number(splitCount || 2));
                        setSplitParts(buildEqualSplitParts(count, dueNow));
                      }
                    }
                  }}
                  className={`pay-btn h-11 ${paymentMethod === m ? 'pay-btn-active' : ''}`}
                >
                  {m}
                </button>
              ))}
            </div>
            {paymentMethod === 'Split' && (
              (() => {
                const table = tables.find((x) => x.id === payTableId);
                if (!table) return null;
                const itemsSnapshot = Array.isArray(table.items) ? [...table.items] : [];
                const itemsTotal = itemsSnapshot.reduce((acc: Decimal, row: any) => acc.plus(new Decimal(row.price || 0).times(row.qty || 0)), new Decimal(0));
                const serviceFee = itemsTotal.times(serviceFeePercent).div(100).toDecimalPlaces(2);
                const deposit = new Decimal(table.deposit_amount || 0);
                const finalTotal = Decimal.max(itemsTotal.plus(serviceFee), deposit).toDecimalPlaces(2);
                const dueNow = Decimal.max(new Decimal(0), finalTotal.minus(deposit)).toDecimalPlaces(2);
                const participantCount = Math.max(2, Number(splitCount || 2));
                const partsTotal = splitParts.reduce((acc, row) => acc.plus(new Decimal(row.amount || 0)), new Decimal(0)).toDecimalPlaces(2);
                const diff = dueNow.minus(partsTotal).toDecimalPlaces(2);
                return (
                  <div className="mt-3 rounded-xl border border-slate-700/60 bg-slate-950/30 p-3">
                    <label className="block text-sm text-slate-300">
                      {tx(lang, 'Neçə hissəyə bölünsün?', 'На сколько частей разделить?', 'How many parts?')}
                      <input
                        className="neon-input mt-2"
                        type="number"
                        min={2}
                        max={12}
                        value={splitCount}
                        onChange={(e) => {
                          const nextCount = Math.max(2, Number(e.target.value || 2));
                          setSplitCount(String(nextCount));
                          setSplitParts(buildEqualSplitParts(nextCount, dueNow));
                        }}
                      />
                    </label>
                    <div className="mt-3 space-y-2">
                      {(splitParts.length === participantCount ? splitParts : buildEqualSplitParts(participantCount, dueNow)).map((part, idx) => (
                        <div key={`split_part_${idx}`} className="grid grid-cols-[1fr_120px] gap-2">
                          <input
                            className="neon-input"
                            type="number"
                            min={0}
                            step="0.01"
                            value={part.amount}
                            onChange={(e) => {
                              const next = (splitParts.length === participantCount ? [...splitParts] : buildEqualSplitParts(participantCount, dueNow));
                              next[idx] = { ...next[idx], amount: e.target.value };
                              setSplitParts(next);
                            }}
                            placeholder={`${tx(lang, 'Hissə', 'Часть', 'Part')} ${idx + 1}`}
                          />
                          <select
                            className="neon-input"
                            value={part.method}
                            onChange={(e) => {
                              const next = (splitParts.length === participantCount ? [...splitParts] : buildEqualSplitParts(participantCount, dueNow));
                              next[idx] = { ...next[idx], method: e.target.value as 'Nəğd' | 'Kart' };
                              setSplitParts(next);
                            }}
                          >
                            <option value="Nəğd">{tx(lang, 'Nəğd', 'Наличные', 'Cash')}</option>
                            <option value="Kart">{tx(lang, 'Kart', 'Карта', 'Card')}</option>
                          </select>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                      <span>{tx(lang, 'Bölünəcək məbləğ', 'Сумма к разделению', 'Amount to split')}: {dueNow.toFixed(2)} ₼</span>
                      <span className={diff.abs().greaterThan(0.01) ? 'text-rose-300' : 'text-emerald-300'}>
                        {tx(lang, 'Fərq', 'Разница', 'Diff')}: {diff.toFixed(2)} ₼
                      </span>
                    </div>
                  </div>
                );
              })()
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button className="neon-btn rounded-lg px-4 py-2" onClick={() => {
                setPayTableId(null);
                setPaymentMethod('Nəğd');
                setSplitCount('2');
                setSplitParts([]);
                setSplitCash('0');
              }}>{tx(lang, 'Ləğv et', 'Отмена')}</button>
              <button
                className="glossy-gold rounded-lg px-4 py-2 font-semibold"
                onClick={async () => {
                  try {
                    const table = tables.find((x) => x.id === payTableId);
                    if (!table) return;
                    const itemsSnapshot = Array.isArray(table.items) ? [...table.items] : [];
                    const itemsTotal = itemsSnapshot.reduce((acc: Decimal, row: any) => acc.plus(new Decimal(row.price || 0).times(row.qty || 0)), new Decimal(0));
                    const serviceFee = itemsTotal.times(serviceFeePercent).div(100).toDecimalPlaces(2);
                    const deposit = new Decimal(table.deposit_amount || 0);
                    const finalTotal = Decimal.max(itemsTotal.plus(serviceFee), deposit).toDecimalPlaces(2);
                    const dueNow = Decimal.max(new Decimal(0), finalTotal.minus(deposit)).toDecimalPlaces(2);
                    let cash: Decimal | null = null;
                    let card: Decimal | null = null;
                    if (paymentMethod === 'Split') {
                      const participantCount = Math.max(2, Number(splitCount || 2));
                      const normalized = (splitParts.length === participantCount ? splitParts : buildEqualSplitParts(participantCount, dueNow));
                      const cashTotal = normalized
                        .filter((row) => row.method === 'Nəğd')
                        .reduce((acc, row) => acc.plus(new Decimal(row.amount || 0)), new Decimal(0))
                        .toDecimalPlaces(2);
                      const cardTotal = normalized
                        .filter((row) => row.method === 'Kart')
                        .reduce((acc, row) => acc.plus(new Decimal(row.amount || 0)), new Decimal(0))
                        .toDecimalPlaces(2);
                      if (cashTotal.lessThan(0) || cardTotal.lessThan(0) || cashTotal.plus(cardTotal).minus(dueNow).abs().greaterThan(0.01)) {
                        notify('error', tx(lang, 'Split hissələri yekun əlavə ödənişə bərabər olmalıdır', 'Сумма частей split должна совпадать с доплатой', 'Split parts must match the due amount'));
                        return;
                      }
                      cash = cashTotal;
                      card = cardTotal;
                    }
                    const result = await pay_table_live(table.id, paymentMethod, user?.username || 'Staff', cash, card, {
                      pay_scope: 'full',
                    });
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
                          <div class="line"><span>Sifariş cəmi</span><span>${itemsTotal.toFixed(2)} ₼</span></div>
                          <div class="line"><span>Servis haqqı</span><span>${serviceFee.toFixed(2)} ₼</span></div>
                          <div class="line"><span>Depozit</span><span>${deposit.toFixed(2)} ₼</span></div>
                          <div class="line"><span>Əlavə ödəniş</span><span>${dueNow.toFixed(2)} ₼</span></div>
                          <div class="line bold" style="font-size:13px"><span>YEKUN</span><span>${finalTotal.toFixed(2)} ₼</span></div>
                          <hr />
                          <div class="muted">${businessProfile?.receipt_footer || 'Bizi seçdiyiniz üçün təşəkkür edirik!'}</div>
                        </body>
                      </html>
                    `);
                    notify('success', tx(lang, 'Masa hesabı bağlandı', 'Счет стола закрыт'));
                    window.dispatchEvent(new CustomEvent('inventory-updated', { detail: { tenant_id, sale_id: result.sale_id, source: 'table' } }));
                    window.dispatchEvent(new CustomEvent('logs-updated', { detail: { tenant_id, sale_id: result.sale_id, source: 'table' } }));
                    setPayTableId(null);
                    setPaymentMethod('Nəğd');
                    setSplitCount('2');
                    setSplitParts([]);
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

      {openTableId && (
        <div className="fixed inset-0 z-[130] flex items-end justify-center bg-black/65 p-0 md:items-center md:p-4">
          <div className="metal-panel w-full max-w-md rounded-t-[28px] p-5 md:rounded-2xl">
            <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-slate-600 md:hidden" />
            <h3 className="text-lg font-bold text-slate-100">{tx(lang, 'Masa Açılışı', 'Открытие стола', 'Open Table')}</h3>
            <p className="mt-2 text-sm text-slate-300">
              {tx(
                lang,
                'Masada neçə nəfər əyləşib və hansıları üçün depozit alındığını seçin.',
                'Выберите, сколько гостей сидит за столом и за кого взят депозит.',
                'Choose how many guests are seated and who has paid the deposit.',
              )}
            </p>
            <div className="mt-4">
              <label className="text-sm text-slate-300">
                {tx(lang, 'Qonaq sayı', 'Количество гостей', 'Guest count')}
                <input
                  className="neon-input mt-1"
                  type="number"
                  min={1}
                  max={20}
                  value={guestCount}
                  onChange={(e) => setGuestCount(e.target.value)}
                />
              </label>
            </div>
            <div className="mt-4 rounded-xl border border-slate-700/60 bg-slate-950/30 p-3">
              <div className="text-sm font-semibold text-slate-100">{tx(lang, 'Depozit seçimi', 'Выбор депозита', 'Deposit selection')}</div>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {depositSelections.map((checked, idx) => (
                  <label key={idx} className="flex items-center justify-between rounded-lg border border-slate-700/60 bg-slate-900/50 px-3 py-2 text-sm text-slate-200">
                    <span>{`Adam-${idx + 1}`}</span>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = [...depositSelections];
                        next[idx] = e.target.checked;
                        setDepositSelections(next);
                      }}
                    />
                  </label>
                ))}
              </div>
              <div className="mt-3 text-xs text-slate-400">
                {tx(lang, 'Nəfər başı depozit', 'Депозит с человека', 'Deposit per guest')}: {depositPerGuest.toFixed(2)} ₼
              </div>
              <div className="mt-1 text-sm font-semibold text-emerald-200">
                {tx(lang, 'Toplam depozit', 'Итоговый депозит', 'Total deposit')}: {depositPerGuest.times(depositSelections.filter(Boolean).length).toFixed(2)} ₼
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="neon-btn rounded-lg px-4 py-2"
                onClick={() => {
                  setOpenTableId(null);
                  setGuestCount('1');
                  setDepositSelections([false]);
                }}
              >
                {tx(lang, 'Ləğv et', 'Отмена', 'Cancel')}
              </button>
              <button className="glossy-gold rounded-lg px-4 py-2 font-semibold" onClick={() => { void handleOpenTable(); }}>
                {tx(lang, 'Masanı Aç', 'Открыть стол', 'Open Table')}
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
              const activeKitchenOrders = kitchenOrders.filter((row) => row.table_label === t.label);
              const waitingItems = activeKitchenOrders
                .filter((row) => ['NEW', 'PREPARING'].includes(String(row.status || '')))
                .flatMap((row) => (Array.isArray(row.items) ? row.items : []))
                .filter((row: any) => String(row.action || '').toUpperCase() !== 'CANCEL');
              const readyItems = activeKitchenOrders
                .filter((row) => String(row.status || '') === 'READY')
                .flatMap((row) => Array.isArray(row.items) ? row.items : [])
                .filter((row: any) => String(row.action || '').toUpperCase() !== 'CANCEL');
              const revisionItems = activeKitchenOrders
                .flatMap((row) => Array.isArray(row.items) ? row.items : [])
                .filter((row: any) => String(row.action || '').toUpperCase() === 'CANCEL');
              const otherTables = tables.filter((row) => row.id !== t.id);
              return (
                <>
                  <h3 className="text-lg font-bold text-slate-100">{t.label}</h3>
                  <div className="mt-1 text-xs text-slate-400">{tx(lang, 'Masa sifariş detalı', 'Детали заказа стола', 'Table order detail')}</div>
                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                    <div className="rounded-lg border border-slate-700/60 bg-slate-950/30 p-3 text-sm text-slate-200">
                      <div className="text-xs uppercase tracking-[0.14em] text-slate-400">{tx(lang, 'Qonaq sayı', 'Гостей', 'Guests')}</div>
                      <div className="mt-1 text-lg font-bold text-slate-100">{Number(t.guest_count || 0)}</div>
                    </div>
                    <div className="rounded-lg border border-slate-700/60 bg-slate-950/30 p-3 text-sm text-slate-200">
                      <div className="text-xs uppercase tracking-[0.14em] text-slate-400">{tx(lang, 'Depozitli adam', 'Гостей с депозитом', 'Deposited guests')}</div>
                      <div className="mt-1 text-lg font-bold text-slate-100">{Number(t.deposit_guest_count || 0)}</div>
                    </div>
                    <div className="rounded-lg border border-slate-700/60 bg-slate-950/30 p-3 text-sm text-slate-200">
                      <div className="text-xs uppercase tracking-[0.14em] text-slate-400">{tx(lang, 'Depozit', 'Депозит', 'Deposit')}</div>
                      <div className="mt-1 text-lg font-bold text-emerald-200">{new Decimal(t.deposit_amount || 0).toFixed(2)} ₼</div>
                    </div>
                  </div>
                  <div className="mt-4 rounded-xl border border-slate-700/70 bg-slate-900/35 p-3">
                    <div className="rounded-lg border border-slate-700/60 bg-slate-950/30 p-3 text-sm text-slate-300">
                      <div className="font-semibold text-slate-100">{tx(lang, 'Masa sifarişləri', 'Заказы стола', 'Table orders')}</div>
                      <div className="mt-1 text-xs text-slate-400">
                        {tx(lang, 'Bu masanın bütün məhsulları burada bir yerdə görünür. Artıq ayrıca adam/seat bölünməsi yoxdur.', 'Все позиции этого стола показаны вместе. Деление по гостям больше не используется.', 'All table items are shown together. Per-person seat splitting is no longer used.')}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 max-h-72 overflow-auto rounded-lg border border-slate-700/70 bg-slate-900/40 p-3">
                    {items.length === 0 && <div className="text-sm text-slate-400">{tx(lang, 'Masa boşdur', 'Стол пуст', 'Table is empty')}</div>}
                    {items.map((it: any, idx: number) => (
                      <div key={`${it.item_name}_${idx}`} className="flex items-center justify-between gap-3 border-b border-slate-700/40 py-2 text-sm last:border-b-0">
                        <div>
                          <div>{it.item_name}</div>
                          <div className="mt-1 text-xs text-slate-500">x{it.qty}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            className="rounded-md border border-amber-300/40 bg-amber-500/10 px-2 py-1 text-xs font-semibold text-amber-100"
                            onClick={async (e) => {
                              e.stopPropagation();
                              const nextItems = items
                                .map((row: any, rowIdx: number) => rowIdx === idx ? { ...row, qty: Number(row.qty || 0) - 1 } : row)
                                .filter((row: any) => Number(row.qty || 0) > 0);
                              setRevisionTarget({ tableId: t.id, itemName: it.item_name, nextItems });
                            }}
                          >
                            -1
                          </button>
                          <button
                            className="rounded-md border border-rose-300/40 bg-rose-500/10 px-2 py-1 text-xs font-semibold text-rose-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              const nextItems = items.filter((_: any, rowIdx: number) => rowIdx !== idx);
                              setRevisionTarget({ tableId: t.id, itemName: it.item_name, nextItems });
                            }}
                          >
                            {tx(lang, 'Sil', 'Убрать', 'Remove')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 rounded-xl border border-slate-700/70 bg-slate-900/35 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="text-base font-semibold text-slate-100">{tx(lang, 'Bu masa üçün sifarişi POS ekranında vur', 'Добавляйте заказ для этого стола через POS', 'Add this table order in POS')}</div>
                        <div className="mt-1 text-sm text-slate-400">
                          {tx(
                            lang,
                            'Sistem sizi avtomatik POS-a keçirəcək. Orada “bu seçim Masa üçündür” bildirişi çıxacaq və seçdiyiniz item-lər Masaya Göndər ilə buraya düşəcək.',
                            'Система автоматически переведет вас в POS. Там появится заметка, что заказ идет на этот стол, и позиции после отправки на кухню вернутся сюда.',
                            'The system will switch you to POS automatically. You will see a notice that the order is for this table, and sent items will appear here after Send to Kitchen.',
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => openTableInPos(t)}
                        className="glossy-gold inline-flex min-h-14 items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold"
                      >
                        <ArrowRightCircle size={20} />
                        {tx(lang, 'POS-da sifariş yaz', 'Открыть POS для стола', 'Open in POS')}
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div className="rounded-lg border border-blue-300/30 bg-blue-500/10 p-3">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-blue-200">{tx(lang, 'Mətbəxdə gözləyənlər', 'Ожидают на кухне', 'Waiting in kitchen')}</div>
                      <div className="space-y-2 text-sm text-slate-100">
                        {waitingItems.length === 0 ? <div className="text-xs text-slate-400">{tx(lang, 'Aktiv gözləyən item yoxdur', 'Нет ожидающих позиций', 'No waiting items')}</div> : waitingItems.map((row: any, idx: number) => (
                          <div key={`wait_${idx}`} className="rounded-md bg-black/15 px-3 py-2">{row.qty}x {row.item_name}</div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-lg border border-emerald-300/30 bg-emerald-500/10 p-3">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-200">{tx(lang, 'Hazır olanlar', 'Готово', 'Ready items')}</div>
                      <div className="space-y-2 text-sm text-slate-100">
                        {readyItems.length === 0 ? <div className="text-xs text-slate-400">{tx(lang, 'Hazır item yoxdur', 'Нет готовых позиций', 'No ready items')}</div> : readyItems.map((row: any, idx: number) => (
                          <div key={`ready_${idx}`} className="rounded-md bg-black/15 px-3 py-2">{row.qty}x {row.item_name}</div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-lg border border-rose-300/30 bg-rose-500/10 p-3">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-rose-200">{tx(lang, 'Dəyişikliklər', 'Изменения', 'Revisions')}</div>
                      <div className="space-y-2 text-sm text-slate-100">
                        {revisionItems.length === 0 ? <div className="text-xs text-slate-400">{tx(lang, 'Düzəliş yoxdur', 'Нет изменений', 'No revisions')}</div> : revisionItems.map((row: any, idx: number) => (
                          <div key={`rev_${idx}`} className="rounded-md bg-black/15 px-3 py-2">{row.qty}x {row.item_name}{row.reason ? ` · ${row.reason}` : ''}</div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex justify-between text-sm text-slate-300">
                    <span>{tx(lang, 'Cari hesab', 'Текущий счет', 'Current bill')}</span>
                    <span className="font-semibold text-slate-100">
                      {Decimal.max(
                        new Decimal(t.total || 0).plus(new Decimal(t.total || 0).times(serviceFeePercent).div(100)),
                        new Decimal(t.deposit_amount || 0),
                      ).toFixed(2)} ₼
                    </span>
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
                        className="glossy-gold min-h-12 rounded-xl px-5 py-3 font-semibold"
                        onClick={() => {
                          setPayTableId(t.id);
                          setPayScope('full');
                          setPaySeatLabel('');
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
            onClick={() => {
              if (!t.is_occupied) {
                setOpenTableId(t.id);
                setGuestCount(String(Math.max(1, Number(t.guest_count || 1))));
                setDepositSelections(Array.from({ length: Math.max(1, Number(t.guest_count || 1)) }, (_, idx) => idx < Number(t.deposit_guest_count || 0)));
                return;
              }
              setViewTableId(t.id);
            }}
            className={`min-h-52 p-6 rounded-3xl border-2 flex flex-col items-center justify-center relative transition-all shadow-sm cursor-pointer ${t.is_occupied ? 'bg-red-900/25 border-red-400/70' : 'bg-slate-800/50 border-slate-600/70 hover:border-yellow-300/60'}`}
          >
            <span className="font-bold text-xl text-slate-100">{t.label}</span>
            <span className={`mt-3 min-h-10 rounded-full px-5 py-2 text-sm font-bold ${t.is_occupied ? 'bg-red-400/20 text-red-200 border border-red-300/50' : 'bg-green-400/20 text-green-200 border border-green-300/50'}`}>
                {t.is_occupied ? tx(lang, 'Dolu', 'Занято', 'Occupied') : tx(lang, 'Boş', 'Свободно', 'Available')}
            </span>
            {t.assigned_to && (
              <span className="mt-2 rounded-full border border-cyan-300/40 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold text-cyan-100">
                {tx(lang, 'Sahib', 'Ответственный', 'Owner')}: {t.assigned_to}
              </span>
            )}
            {(Number(t.guest_count || 0) > 0 || new Decimal(t.deposit_amount || 0).greaterThan(0)) && (
              <div className="mt-2 text-center text-[11px] text-slate-300">
                <div>{tx(lang, 'Qonaq', 'Гости', 'Guests')}: {Number(t.guest_count || 0)}</div>
                <div>{tx(lang, 'Depozit', 'Депозит', 'Deposit')}: {new Decimal(t.deposit_amount || 0).toFixed(2)} ₼</div>
              </div>
            )}
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
                onClick={(e) => { e.stopPropagation(); setPayTableId(t.id); setPayScope('full'); setPaySeatLabel(''); }}
                className="mt-4 inline-flex min-h-14 w-full items-center justify-center rounded-2xl border border-yellow-300/60 bg-yellow-400/20 px-4 py-3 text-base font-bold text-yellow-100"
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

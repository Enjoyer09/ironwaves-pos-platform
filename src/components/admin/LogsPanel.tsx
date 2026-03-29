import React, { useMemo, useState } from 'react';
import { clear_ui_errors, get_logs_live, get_ui_errors } from '../../api/logs';
import { useAppStore } from '../../store';
import { tx } from '../../i18n';

export default function LogsPanel() {
  const { user, lang } = useAppStore();
  const tenant_id = user?.tenant_id || 'tenant_default';
  const [limit, setLimit] = useState(100);
  const [pageSize, setPageSize] = useState(10);
  const [query, setQuery] = useState('');
  const [fromDate, setFromDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [logs, setLogs] = useState<any[]>([]);
  const uiErrors = useMemo(() => get_ui_errors(tenant_id, 20), [tenant_id, logs.length]);

  React.useEffect(() => {
    void get_logs_live(tenant_id, limit, fromDate, toDate).then(setLogs).catch(() => setLogs([]));
  }, [tenant_id, limit, fromDate, toDate]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter((l: any) => {
      const row = `${l.user} ${l.action} ${JSON.stringify(l.details || {})}`.toLowerCase();
      return row.includes(q);
    });
  }, [logs, query]);

  const visibleLogs = useMemo(() => filtered.slice(0, pageSize), [filtered, pageSize]);

  const parseDetails = (details: any) => {
    if (typeof details === 'string') {
      try {
        return JSON.parse(details);
      } catch {
        return { message: details };
      }
    }
    return details || {};
  };

  const humanizeAction = (actionRaw: string) => {
    const action = String(actionRaw || '').toUpperCase();
    const labels: Record<string, string> = {
      MENU_ADD: tx(lang, 'Menyuya yeni məhsul əlavə edildi', 'В меню добавлен новый товар', 'New menu item added'),
      MENU_EDIT: tx(lang, 'Menyu məhsulu yeniləndi', 'Позиция меню обновлена', 'Menu item updated'),
      MENU_SOFT_DELETE: tx(lang, 'Menyu məhsulu deaktiv edildi', 'Позиция меню деактивирована', 'Menu item deactivated'),
      INVENTORY_ADD: tx(lang, 'Anbara yeni məhsul əlavə edildi', 'На склад добавлен товар', 'Inventory item added'),
      INVENTORY_RESTOCK: tx(lang, 'Anbara əlavə mədaxil yazıldı', 'Склад пополнен', 'Inventory restocked'),
      INVENTORY_LOSS: tx(lang, 'Anbardan itki/zay yazıldı', 'Со склада списана потеря', 'Inventory loss recorded'),
      INVENTORY_DELETE: tx(lang, 'Anbar məhsulu silindi', 'Товар на складе удален', 'Inventory item deleted'),
      SALE_VOIDED: tx(lang, 'Satış ləğv edildi', 'Продажа аннулирована', 'Sale voided'),
      SALE_PARTIAL_REFUND: tx(lang, 'Qismən refund edildi', 'Сделан частичный возврат', 'Partial refund applied'),
      REFUND_CREATED: tx(lang, 'Refund yaradıldı', 'Возврат создан', 'Refund created'),
      TABLE_CREATED: tx(lang, 'Yeni masa yaradıldı', 'Создан новый стол', 'Table created'),
      TABLE_DELETED: tx(lang, 'Masa silindi', 'Стол удален', 'Table deleted'),
      TABLE_TRANSFERRED: tx(lang, 'Sifariş başqa masaya köçürüldü', 'Заказ перенесен на другой стол', 'Order transferred to another table'),
      TABLE_MERGED: tx(lang, 'Masalar birləşdirildi', 'Столы объединены', 'Tables merged'),
      TABLE_SENT_TO_KITCHEN: tx(lang, 'Sifariş mətbəxə göndərildi', 'Заказ отправлен на кухню', 'Order sent to kitchen'),
      KITCHEN_ACCEPTED: tx(lang, 'Mətbəx sifarişi qəbul etdi', 'Кухня приняла заказ', 'Kitchen accepted the order'),
      KITCHEN_COMPLETED: tx(lang, 'Mətbəx sifarişi hazır etdi', 'Кухня завершила заказ', 'Kitchen marked order ready'),
      X_REPORT_CREATED: tx(lang, 'X-hesabat yaradıldı', 'Создан X-отчет', 'X report created'),
      Z_REPORT_CREATED: tx(lang, 'Z-hesabat yaradıldı', 'Создан Z-отчет', 'Z report created'),
      SHIFT_OPENED: tx(lang, 'Gün/növbə açıldı', 'Смена открыта', 'Shift opened'),
      SHIFT_CLOSED: tx(lang, 'Gün/növbə bağlandı', 'Смена закрыта', 'Shift closed'),
      SHIFT_HANDOVER: tx(lang, 'Növbə təhvil verildi', 'Смена передана', 'Shift handed over'),
      SHIFT_HANDOVER_ACCEPTED: tx(lang, 'Növbə qəbul edildi', 'Смена принята', 'Shift handover accepted'),
      USER_UPSERT: tx(lang, 'İstifadəçi yaradıldı və ya yeniləndi', 'Пользователь создан или обновлен', 'User created or updated'),
      USER_DELETE: tx(lang, 'İstifadəçi silindi', 'Пользователь удален', 'User deleted'),
      USER_CREDENTIALS_UPDATED: tx(lang, 'İstifadəçi şifrəsi və ya PIN-i yeniləndi', 'Пароль или PIN пользователя обновлен', 'User password or PIN updated'),
      BUSINESS_PROFILE_UPDATED: tx(lang, 'Biznes profili yeniləndi', 'Профиль бизнеса обновлен', 'Business profile updated'),
      PRINT_SETTINGS_UPDATED: tx(lang, 'Çap ayarları yeniləndi', 'Настройки печати обновлены', 'Print settings updated'),
      QR_SETTINGS_UPDATED: tx(lang, 'QR ayarları yeniləndi', 'Настройки QR обновлены', 'QR settings updated'),
      CRM_SEND: tx(lang, 'CRM email göndərişi edildi', 'CRM-рассылка отправлена', 'CRM email sent'),
      QR_GENERATED: tx(lang, 'Yeni QR yaradıldı', 'Создан новый QR', 'New QR generated'),
      OFFLINE_SALES_SYNCED: tx(lang, 'Offline satışlar serverə göndərildi', 'Оффлайн продажи синхронизированы', 'Offline sales synced'),
    };
    return labels[action] || action.replace(/_/g, ' ').toLowerCase();
  };

  const summarizeDetails = (actionRaw: string, detailsRaw: any) => {
    const action = String(actionRaw || '').toUpperCase();
    const details = parseDetails(detailsRaw);
    const itemName = String(details.item_name || details.name || details.item || '').trim();
    const qty = details.qty ?? details.qty_added ?? details.qty_removed;
    const unit = details.unit ? ` ${details.unit}` : '';
    const amount = details.amount || details.total || details.value;
    const targetUser = details.received_by || details.username || details.target_user;
    if (action === 'INVENTORY_ADD' && itemName) return `${itemName} • ${qty || 0}${unit}`;
    if (action === 'INVENTORY_RESTOCK' && itemName) return `${itemName} • +${qty || 0}${unit}`;
    if (action === 'INVENTORY_LOSS' && itemName) return `${itemName} • -${qty || 0}${unit}`;
    if (action === 'SALE_VOIDED' && details.sale_id) return `sale_id: ${details.sale_id}`;
    if (action === 'SALE_PARTIAL_REFUND' && amount) return `${tx(lang, 'Refund məbləği', 'Сумма возврата', 'Refund amount')}: ${amount}`;
    if ((action === 'SHIFT_HANDOVER' || action === 'SHIFT_HANDOVER_ACCEPTED') && targetUser) return `${tx(lang, 'İşçi', 'Сотрудник', 'Staff')}: ${targetUser}`;
    if (amount) return `${tx(lang, 'Məbləğ', 'Сумма', 'Amount')}: ${amount}`;
    if (itemName) return itemName;
    return details.message || '-';
  };

  const renderDetails = (details: any) => {
    const parsed = parseDetails(details);
    if (!parsed || Object.keys(parsed).length === 0) return '-';
    return (
      <div className="space-y-1 rounded-md border border-slate-700/70 bg-slate-900/40 p-2">
        {Object.entries(parsed).map(([k, v]) => (
          <div key={k} className="flex items-start gap-2 text-[11px] leading-4 text-slate-200">
            <span className="min-w-[120px] text-slate-400">{k}</span>
            <span className="font-mono break-all text-slate-100">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
          </div>
        ))}
      </div>
    );
  };

  const copySaleId = async (details: any) => {
    let parsed = details;
    if (typeof details === 'string') {
      try {
        parsed = JSON.parse(details);
      } catch {
        parsed = null;
      }
    }
    const saleId = parsed?.sale_id;
    if (!saleId) return;
    try {
      await navigator.clipboard.writeText(String(saleId));
    } catch {
      // ignore clipboard errors silently
    }
  };

  return (
    <div className="space-y-4 text-slate-100">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{tx(lang, 'Sistem Loqları', 'Системные логи')}</h2>
        <div className="flex items-center gap-2">
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="neon-input" />
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="neon-input" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tx(lang, 'Action və ya user ilə axtar...', 'Поиск по действию или пользователю...')}
            className="neon-input"
          />
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="neon-input"
          >
            <option value={100}>100</option>
            <option value={250}>250</option>
            <option value={500}>500</option>
            <option value={1000}>1000</option>
          </select>
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="neon-input">
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={20}>20</option>
          </select>
        </div>
      </div>

      <div className="metal-panel overflow-x-auto">
        {user?.role === 'admin' && (
          <div className="border-b border-slate-700/60 px-4 py-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-red-200">{tx(lang, 'UI Telemetri (POS/KDS)', 'UI телеметрия (POS/KDS)')}</h3>
              <button
                className="neon-btn rounded-lg px-2 py-1 text-xs"
                onClick={() => {
                  clear_ui_errors(tenant_id);
                  window.location.reload();
                }}
              >
                {tx(lang, 'Telemetri təmizlə', 'Очистить телеметрию')}
              </button>
            </div>
            {uiErrors.length === 0 ? (
              <div className="text-xs text-slate-400">{tx(lang, 'UI xətası qeydi yoxdur', 'Записей UI-ошибок нет')}</div>
            ) : (
              <div className="max-h-40 space-y-2 overflow-y-auto pr-1 text-xs">
                {uiErrors.map((e: any) => (
                  <div key={e.id} className="rounded-md border border-red-300/30 bg-red-900/10 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-red-200">{e.module}</span>
                      <span className="text-slate-400">{new Date(e.created_at).toLocaleString(lang === 'ru' ? 'ru-RU' : 'az-AZ')}</span>
                    </div>
                    <div className="mt-1 break-all text-slate-200">{e.message}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900/50 text-slate-300">
            <tr>
              <th className="px-4 py-3">{tx(lang, 'Tarix', 'Дата')}</th>
              <th className="px-4 py-3">{tx(lang, 'İstifadəçi', 'Пользователь')}</th>
              <th className="px-4 py-3">{tx(lang, 'Əməliyyat', 'Действие', 'Action')}</th>
              <th className="px-4 py-3">{tx(lang, 'Qısa izah', 'Краткое описание', 'Human summary')}</th>
              <th className="px-4 py-3">{tx(lang, 'Texniki detallar', 'Технические детали', 'Technical details')}</th>
            </tr>
          </thead>
          <tbody>
            {visibleLogs.map((log: any) => (
              <tr key={log.id} className="border-t border-slate-700/60 align-top">
                <td className="px-4 py-3">{new Date(log.created_at).toLocaleString(lang === 'ru' ? 'ru-RU' : 'az-AZ')}</td>
                <td className="px-4 py-3 font-medium">{log.user}</td>
                <td className="px-4 py-3">
                  <span className="rounded-md border border-yellow-300/40 bg-yellow-400/10 px-2 py-1 text-xs font-semibold text-yellow-200">
                    {humanizeAction(log.action)}
                  </span>
                  <div className="mt-2 text-[11px] text-slate-500">{log.action}</div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-200">{summarizeDetails(log.action, log.details)}</td>
                <td className="px-4 py-3 text-xs text-slate-300">
                  {renderDetails(log.details)}
                  {(String(log.action || '').includes('SALE') || String(log.action || '').includes('REFUND')) && (
                    <button
                      className="mt-2 rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700/40"
                      onClick={() => copySaleId(log.details)}
                    >
                      {tx(lang, 'sale_id kopyala', 'копировать sale_id')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  {tx(lang, 'Loq tapılmadı', 'Логи не найдены')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="border-t border-slate-700/60 px-4 py-3 text-xs text-slate-400">
          {tx(lang, 'Ekranda görünən', 'На экране', 'Showing')}: <b>{visibleLogs.length}</b> / {filtered.length}
        </div>
      </div>
    </div>
  );
}

import React from 'react';
import { Download } from 'lucide-react';
import { getApiBaseUrl, getClientAuthSession, isBackendEnabled } from '../../api/client';
import { get_feedback_inbox_live } from '../../api/feedback';
import { tx } from '../../i18n';

type Props = {
  tenantId: string;
  dateFrom: string;
  dateTo: string;
  lang: string;
};

export default function FeedbackInboxPanel({ tenantId, dateFrom, dateTo, lang }: Props) {
  const [rows, setRows] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [downloading, setDownloading] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const data = await get_feedback_inbox_live(tenantId, dateFrom, dateTo, 500);
        if (!cancelled) setRows(Array.isArray(data) ? data : []);
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message || 'Feedback inbox yüklənmədi'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, dateFrom, dateTo]);

  const onDownloadCsv = async () => {
    if (!isBackendEnabled()) return;
    try {
      setDownloading(true);
      const base = getApiBaseUrl();
      const auth = getClientAuthSession().access_token;
      if (!base) throw new Error('API base URL yoxdur');
      const url = `${base}/api/v1/ops/feedback/inbox/export.csv?date_from=${encodeURIComponent(dateFrom)}&date_to=${encodeURIComponent(dateTo)}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
          'x-tenant-domain': window.location.host,
        },
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`CSV export error: ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `feedback_inbox_${dateFrom}_${dateTo}.csv`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch (e: any) {
      setError(String(e?.message || 'CSV export alınmadı'));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="metal-panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-700/70 p-6">
        <div>
          <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'Feedback Inbox', 'Feedback Inbox', 'Feedback Inbox')}</h2>
          <p className="mt-1 text-xs text-slate-400">
            {tx(lang, 'Score, comment, contact və kupon statusu', 'Score, comment, contact и статус купона', 'Score, comment, contact and coupon status')}
          </p>
        </div>
        <button
          type="button"
          onClick={onDownloadCsv}
          disabled={downloading || !isBackendEnabled()}
          className="neon-btn flex items-center gap-2 rounded-lg px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download size={16} />
          {downloading ? tx(lang, 'Yüklənir...', 'Загрузка...', 'Downloading...') : tx(lang, 'CSV export', 'CSV экспорт', 'CSV export')}
        </button>
      </div>
      {error ? <div className="px-6 py-3 text-sm text-rose-300">{error}</div> : null}
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-slate-900/40 text-xs font-semibold uppercase tracking-wider text-slate-300">
            <tr>
              <th className="px-4 py-3">{tx(lang, 'Tarix', 'Дата', 'Date')}</th>
              <th className="px-4 py-3">{tx(lang, 'Bal', 'Оценка', 'Score')}</th>
              <th className="px-4 py-3">{tx(lang, 'Rəy', 'Комментарий', 'Comment')}</th>
              <th className="px-4 py-3">{tx(lang, 'Əlaqə', 'Контакт', 'Contact')}</th>
              <th className="px-4 py-3">{tx(lang, 'Çek', 'Чек', 'Receipt')}</th>
              <th className="px-4 py-3">{tx(lang, 'Staff', 'Сотрудник', 'Staff')}</th>
              <th className="px-4 py-3">{tx(lang, 'Kupon', 'Купон', 'Coupon')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/60">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-5 text-center text-slate-400">
                  {tx(lang, 'Yüklənir...', 'Загрузка...', 'Loading...')}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-5 text-center text-slate-400">
                  {tx(lang, 'Bu tarix aralığında feedback yoxdur', 'За этот период нет отзывов', 'No feedback in this date range')}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={String(row.id)}>
                  <td className="px-4 py-3 text-xs text-slate-300">{String(row.created_at || '').replace('T', ' ').slice(0, 19)}</td>
                  <td className="px-4 py-3 text-sm font-semibold text-amber-300">{Number(row.score || 0)}</td>
                  <td className="max-w-[340px] px-4 py-3 text-sm text-slate-200">{String(row.comment || '-')}</td>
                  <td className="px-4 py-3 text-sm text-slate-300">{String(row.contact || '-')}</td>
                  <td className="px-4 py-3 text-xs font-mono text-cyan-300">{String(row.receipt_id || '-')}</td>
                  <td className="px-4 py-3 text-sm text-slate-300">{String(row.staff_username || '-')}</td>
                  <td className="px-4 py-3 text-xs">
                    {row.coupon_code ? (
                      <span className="rounded border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 text-emerald-200">
                        {row.coupon_code} ({row.coupon_status || 'PENDING'})
                      </span>
                    ) : (
                      <span className="text-slate-500">-</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

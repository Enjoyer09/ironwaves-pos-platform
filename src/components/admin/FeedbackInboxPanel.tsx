import React from 'react';
import { Download, Filter, BarChart3 } from 'lucide-react';
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
  const [filterScore, setFilterScore] = React.useState<string>('all');
  const [filterStatus, setFilterStatus] = React.useState<string>('all');
  const [currentPage, setCurrentPage] = React.useState(1);
  const rowsPerPage = 20;

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

  const filteredRows = React.useMemo(() => {
    return rows.filter((row) => {
      if (filterScore !== 'all' && Number(row.score) !== Number(filterScore)) return false;
      if (filterStatus !== 'all') {
        const status = String(row.coupon_status || 'PENDING');
        if (filterStatus === 'no_coupon' && row.coupon_code) return false;
        if (filterStatus !== 'no_coupon' && status !== filterStatus) return false;
      }
      return true;
    });
  }, [rows, filterScore, filterStatus]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / rowsPerPage));
  const paginatedRows = filteredRows.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  const analytics = React.useMemo(() => {
    const total = filteredRows.length;
    const avgScore = total > 0 ? filteredRows.reduce((sum, r) => sum + Number(r.score || 0), 0) / total : 0;
    const withCoupons = filteredRows.filter((r) => r.coupon_code).length;
    const redeemed = filteredRows.filter((r) => String(r.coupon_status || '') === 'REDEEMED').length;
    const redemptionRate = withCoupons > 0 ? (redeemed / withCoupons) * 100 : 0;
    return { total, avgScore: avgScore.toFixed(1), withCoupons, redeemed, redemptionRate: redemptionRate.toFixed(1) };
  }, [filteredRows]);

  const onDownloadCsv = async () => {
    if (!isBackendEnabled()) return;
    try {
      setDownloading(true);
      const base = getApiBaseUrl();
      const session = getClientAuthSession();
      const auth = session?.access_token;
      if (!base) throw new Error('API base URL yoxdur');
      if (!auth) throw new Error('Auth token yoxdur - zəhmət olmasa yenidən daxil olun');
      const url = `${base}/api/v1/ops/feedback/inbox/export.csv?date_from=${encodeURIComponent(dateFrom)}&date_to=${encodeURIComponent(dateTo)}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${auth}`,
          'x-tenant-domain': window.location.host,
        },
        credentials: 'include',
      });
      if (!res.ok) {
        const msg = res.status === 401 ? 'İcazə yoxdur (401)' : `CSV export error: ${res.status}`;
        throw new Error(msg);
      }
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
      <div className="border-b border-slate-700/50 bg-slate-900/30 p-4">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="flex items-center gap-2 rounded-lg bg-slate-800/40 px-3 py-2">
            <BarChart3 size={16} className="text-cyan-400" />
            <div>
              <div className="text-xs text-slate-400">{tx(lang, 'Orta bal', 'Средний балл', 'Avg Score')}</div>
              <div className="text-sm font-semibold text-amber-300">{analytics.avgScore} ⭐</div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-slate-800/40 px-3 py-2">
            <div>
              <div className="text-xs text-slate-400">{tx(lang, 'Ümumi', 'Всего', 'Total')}</div>
              <div className="text-sm font-semibold text-slate-100">{analytics.total}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-slate-800/40 px-3 py-2">
            <div>
              <div className="text-xs text-slate-400">{tx(lang, 'Kuponlar', 'Купоны', 'Coupons')}</div>
              <div className="text-sm font-semibold text-emerald-300">{analytics.withCoupons}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-slate-800/40 px-3 py-2">
            <div>
              <div className="text-xs text-slate-400">{tx(lang, 'İstifadə', 'Использовано', 'Redeemed')}</div>
              <div className="text-sm font-semibold text-purple-300">{analytics.redemptionRate}%</div>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Filter size={14} className="text-slate-400" />
          <select
            value={filterScore}
            onChange={(e) => { setFilterScore(e.target.value); setCurrentPage(1); }}
            className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200"
          >
            <option value="all">{tx(lang, 'Bütün ballar', 'Все оценки', 'All scores')}</option>
            <option value="5">⭐⭐⭐⭐⭐ (5)</option>
            <option value="4">⭐⭐⭐⭐ (4)</option>
            <option value="3">⭐⭐⭐ (3)</option>
            <option value="2">⭐⭐ (2)</option>
            <option value="1">⭐ (1)</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value); setCurrentPage(1); }}
            className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200"
          >
            <option value="all">{tx(lang, 'Bütün statuslar', 'Все статусы', 'All statuses')}</option>
            <option value="PENDING">{tx(lang, 'Gözləyir', 'Ожидает', 'Pending')}</option>
            <option value="REDEEMED">{tx(lang, 'İstifadə edilib', 'Использован', 'Redeemed')}</option>
            <option value="no_coupon">{tx(lang, 'Kuponsuz', 'Без купона', 'No coupon')}</option>
          </select>
        </div>
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
            ) : paginatedRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-5 text-center text-slate-400">
                  {tx(lang, 'Bu tarix aralığında feedback yoxdur', 'За этот период нет отзывов', 'No feedback in this date range')}
                </td>
              </tr>
            ) : (
              paginatedRows.map((row) => (
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
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-700/50 bg-slate-900/20 px-6 py-3">
          <div className="text-xs text-slate-400">
            {tx(lang, `Səhifə ${currentPage} / ${totalPages}`, `Страница ${currentPage} / ${totalPages}`, `Page ${currentPage} / ${totalPages}`)}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="rounded border border-slate-600 bg-slate-800 px-3 py-1 text-xs text-slate-200 disabled:opacity-50"
            >
              ← {tx(lang, 'Əvvəlki', 'Предыдущая', 'Previous')}
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="rounded border border-slate-600 bg-slate-800 px-3 py-1 text-xs text-slate-200 disabled:opacity-50"
            >
              {tx(lang, 'Növbəti', 'Следующая', 'Next')} →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

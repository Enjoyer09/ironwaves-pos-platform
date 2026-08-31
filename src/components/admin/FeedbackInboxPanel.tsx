import React from 'react';
import { Download, Filter, BarChart3, Star, TrendingUp, Award, RefreshCw } from 'lucide-react';
import { getApiBaseUrl, getClientAuthSession, isBackendEnabled } from '../../api/client';
import { get_feedback_inbox_live } from '../../api/feedback';
import { tx } from '../../i18n';

type Props = {
  tenantId: string;
  dateFrom: string;
  dateTo: string;
  lang: string;
};

function ScoreStars({ score }: { score: number }) {
  const filled = Math.min(5, Math.max(0, Math.round(score)));
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          size={14}
          className={
            i < filled
              ? score >= 4
                ? 'fill-amber-400 text-amber-400'
                : score >= 3
                ? 'fill-yellow-400 text-yellow-400'
                : 'fill-rose-400 text-rose-400'
              : 'text-slate-600'
          }
        />
      ))}
      <span className="ml-1.5 text-xs font-semibold text-slate-300">{score.toFixed(0)}</span>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const bg =
    score >= 4
      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
      : score >= 3
      ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
      : 'bg-rose-500/20 text-rose-300 border-rose-500/30';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold ${bg}`}>
      <Star size={10} className="fill-current" />
      {score.toFixed(0)}
    </span>
  );
}

function CouponBadge({ code, status }: { code: string; status: string }) {
  const isRedeemed = status === 'REDEEMED';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold ${
        isRedeemed
          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
          : 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300'
      }`}
    >
      {isRedeemed && <RefreshCw size={10} />}
      <span className="font-mono">{code}</span>
    </span>
  );
}

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
        if (!cancelled) setError(String(e?.message || 'Feedback inbox yuklenme di'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
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
    const scoreDistribution = [1, 2, 3, 4, 5].map((s) => ({
      score: s,
      count: filteredRows.filter((r) => Number(r.score) === s).length,
      pct: total > 0 ? (filteredRows.filter((r) => Number(r.score) === s).length / total) * 100 : 0,
    }));
    return { total, avgScore, withCoupons, redeemed, redemptionRate, scoreDistribution };
  }, [filteredRows]);

  const onDownloadCsv = async () => {
    if (!isBackendEnabled()) return;
    try {
      setDownloading(true);
      const base = getApiBaseUrl();
      const session = getClientAuthSession();
      const auth = session?.access_token;
      if (!base) throw new Error('API base URL yoxdur');
      if (!auth) throw new Error('Auth token yoxdur - zehmet olmasa yeniden daxil olun');
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
        const msg = res.status === 401 ? 'Icaze yoxdur (401)' : `CSV export error: ${res.status}`;
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
      setError(String(e?.message || 'CSV export alinmadi'));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="glass-card group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-800/80 to-slate-900/80 p-4 backdrop-blur-xl transition-all hover:border-white/20 hover:shadow-lg hover:shadow-cyan-500/5">
          <div className="absolute -right-3 -top-3 h-16 w-16 rounded-full bg-cyan-500/10 blur-2xl transition-all group-hover:bg-cyan-500/20" />
          <div className="relative">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/20">
                <BarChart3 size={16} className="text-cyan-400" />
              </div>
              <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                {tx(lang, 'Umumi', 'Vsego', 'Total')}
              </span>
            </div>
            <div className="text-3xl font-bold text-white">{analytics.total}</div>
            <div className="mt-1 text-xs text-slate-500">{tx(lang, 'rey', 'otzyvov', 'reviews')}</div>
          </div>
        </div>

        <div className="glass-card group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-800/80 to-slate-900/80 p-4 backdrop-blur-xl transition-all hover:border-white/20 hover:shadow-lg hover:shadow-amber-500/5">
          <div className="absolute -right-3 -top-3 h-16 w-16 rounded-full bg-amber-500/10 blur-2xl transition-all group-hover:bg-amber-500/20" />
          <div className="relative">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/20">
                <Star size={16} className="text-amber-400" />
              </div>
              <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                {tx(lang, 'Orta bal', 'Sredniy', 'Avg Score')}
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-bold text-white">{analytics.avgScore.toFixed(1)}</span>
              <span className="text-sm text-slate-500">/5</span>
            </div>
            <div className="mt-1"><ScoreStars score={Number(analytics.avgScore)} /></div>
          </div>
        </div>

        <div className="glass-card group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-800/80 to-slate-900/80 p-4 backdrop-blur-xl transition-all hover:border-white/20 hover:shadow-lg hover:shadow-emerald-500/5">
          <div className="absolute -right-3 -top-3 h-16 w-16 rounded-full bg-emerald-500/10 blur-2xl transition-all group-hover:bg-emerald-500/20" />
          <div className="relative">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20">
                <Award size={16} className="text-emerald-400" />
              </div>
              <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                {tx(lang, 'Kuponlar', 'Kupony', 'Coupons')}
              </span>
            </div>
            <div className="text-3xl font-bold text-white">{analytics.withCoupons}</div>
            <div className="mt-1 text-xs text-slate-500">{tx(lang, 'verilib', 'vydano', 'issued')}</div>
          </div>
        </div>

        <div className="glass-card group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-800/80 to-slate-900/80 p-4 backdrop-blur-xl transition-all hover:border-white/20 hover:shadow-lg hover:shadow-violet-500/5">
          <div className="absolute -right-3 -top-3 h-16 w-16 rounded-full bg-violet-500/10 blur-2xl transition-all group-hover:bg-violet-500/20" />
          <div className="relative">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/20">
                <TrendingUp size={16} className="text-violet-400" />
              </div>
              <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                {tx(lang, 'Istifade', 'Ispolzov.', 'Redeemed')}
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-bold text-white">{analytics.redemptionRate.toFixed(0)}</span>
              <span className="text-lg font-semibold text-slate-400">%</span>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {analytics.redeemed} / {analytics.withCoupons} {tx(lang, 'kupon', 'kuponov', 'coupons')}
            </div>
          </div>
        </div>
      </div>

      <div className="glass-card rounded-2xl border border-white/10 bg-gradient-to-br from-slate-800/60 to-slate-900/60 p-5 backdrop-blur-xl">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-300">
          <BarChart3 size={14} className="text-cyan-400" />
          {tx(lang, 'Bal paylanmasi', 'Raspredelenie ocenok', 'Score Distribution')}
        </h3>
        <div className="flex items-end gap-3">
          {analytics.scoreDistribution.map((item) => (
            <div key={item.score} className="flex flex-1 flex-col items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-400">{item.count}</span>
              <div className="relative h-24 w-full overflow-hidden rounded-lg bg-slate-700/30">
                <div
                  className={`absolute bottom-0 left-0 right-0 rounded-lg transition-all duration-500 ${
                    item.score >= 4
                      ? 'bg-gradient-to-t from-emerald-600 to-emerald-400'
                      : item.score >= 3
                      ? 'bg-gradient-to-t from-amber-600 to-amber-400'
                      : 'bg-gradient-to-t from-rose-600 to-rose-400'
                  }`}
                  style={{ height: `${Math.max(4, item.pct)}%` }}
                />
              </div>
              <div className="flex items-center gap-0.5">
                <span className="text-xs font-bold text-slate-300">{item.score}</span>
                <Star size={10} className="fill-amber-400 text-amber-400" />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="glass-card overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-800/60 to-slate-900/60 backdrop-blur-xl">
        <div className="flex flex-col gap-4 border-b border-white/5 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">
              {tx(lang, 'Reyler', 'Otzyvy', 'Reviews')}
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {dateFrom} - {dateTo} | {filteredRows.length} {tx(lang, 'netice', 'rezultatov', 'results')}
            </p>
          </div>
          <button
            type="button"
            onClick={onDownloadCsv}
            disabled={downloading || !isBackendEnabled()}
            className="group inline-flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2.5 text-sm font-semibold text-cyan-300 transition-all hover:border-cyan-400/50 hover:bg-cyan-500/20 hover:shadow-lg hover:shadow-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download size={15} className="transition-transform group-hover:scale-110" />
            {downloading
              ? tx(lang, 'Yuklenir...', 'Zagruzka...', 'Downloading...')
              : tx(lang, 'CSV Export', 'CSV Export', 'CSV Export')}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-white/5 px-5 py-3">
          <Filter size={14} className="text-slate-500" />
          <select
            value={filterScore}
            onChange={(e) => { setFilterScore(e.target.value); setCurrentPage(1); }}
            className="rounded-lg border border-white/10 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 outline-none transition-all focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20"
          >
            <option value="all">{tx(lang, 'Butun ballar', 'Vse ocenki', 'All scores')}</option>
            <option value="5">5 ulduz</option>
            <option value="4">4 ulduz</option>
            <option value="3">3 ulduz</option>
            <option value="2">2 ulduz</option>
            <option value="1">1 ulduz</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value); setCurrentPage(1); }}
            className="rounded-lg border border-white/10 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 outline-none transition-all focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20"
          >
            <option value="all">{tx(lang, 'Butun statuslar', 'Vse statusy', 'All statuses')}</option>
            <option value="PENDING">{tx(lang, 'Gozleyir', 'Ozhidaet', 'Pending')}</option>
            <option value="REDEEMED">{tx(lang, 'Istifade edilib', 'Ispolzovan', 'Redeemed')}</option>
            <option value="no_coupon">{tx(lang, 'Kuponsuz', 'Bez kupona', 'No coupon')}</option>
          </select>
          {(filterScore !== 'all' || filterStatus !== 'all') && (
            <button
              type="button"
              onClick={() => { setFilterScore('all'); setFilterStatus('all'); setCurrentPage(1); }}
              className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-300 transition-all hover:bg-rose-500/20"
            >
              x {tx(lang, 'Sifirla', 'Sbrosit', 'Reset')}
            </button>
          )}
        </div>

        {error && (
          <div className="mx-5 mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            {error}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5 bg-slate-900/40">
                <th className="px-5 py-3.5 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">{tx(lang, 'Tarix', 'Data', 'Date')}</th>
                <th className="px-5 py-3.5 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">{tx(lang, 'Bal', 'Ocenka', 'Score')}</th>
                <th className="px-5 py-3.5 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">{tx(lang, 'Rey', 'Kommentariy', 'Comment')}</th>
                <th className="px-5 py-3.5 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">{tx(lang, 'Elaqe', 'Kontakt', 'Contact')}</th>
                <th className="px-5 py-3.5 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">{tx(lang, 'Cek', 'Chek', 'Receipt')}</th>
                <th className="px-5 py-3.5 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">{tx(lang, 'Staff', 'Sotrudnik', 'Staff')}</th>
                <th className="px-5 py-3.5 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">{tx(lang, 'Kupon', 'Kupon', 'Coupon')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500/30 border-t-cyan-400" />
                      <span className="text-sm text-slate-400">{tx(lang, 'Yuklenir...', 'Zagruzka...', 'Loading...')}</span>
                    </div>
                  </td>
                </tr>
              ) : paginatedRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-700/30">
                        <BarChart3 size={20} className="text-slate-500" />
                      </div>
                      <span className="text-sm font-medium text-slate-400">
                        {tx(lang, 'Bu tarix araliginda feedback yoxdur', 'Za etot period net otzyvov', 'No feedback in this date range')}
                      </span>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedRows.map((row, idx) => {
                  const score = Number(row.score || 0);
                  const rowBg = idx % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.02]';
                  return (
                    <tr key={String(row.id)} className={`group transition-colors hover:bg-white/[0.04] ${rowBg}`}>
                      <td className="whitespace-nowrap px-5 py-3.5">
                        <div className="text-xs font-medium text-slate-300">
                          {String(row.created_at || '').replace('T', ' ').slice(0, 16)}
                        </div>
                      </td>
                      <td className="px-5 py-3.5"><ScoreBadge score={score} /></td>
                      <td className="max-w-[320px] px-5 py-3.5">
                        <p className="line-clamp-2 text-sm leading-relaxed text-slate-200">{String(row.comment || '-')}</p>
                      </td>
                      <td className="px-5 py-3.5"><span className="text-sm text-slate-400">{String(row.contact || '-')}</span></td>
                      <td className="px-5 py-3.5"><span className="font-mono text-xs text-cyan-400/80">{String(row.receipt_id || '-').slice(0, 12)}</span></td>
                      <td className="px-5 py-3.5"><span className="text-sm text-slate-400">{String(row.staff_username || '-')}</span></td>
                      <td className="px-5 py-3.5">
                        {row.coupon_code ? (
                          <CouponBadge code={row.coupon_code} status={String(row.coupon_status || 'PENDING')} />
                        ) : (
                          <span className="text-xs text-slate-600">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-white/5 bg-slate-900/30 px-5 py-3">
            <div className="text-xs font-medium text-slate-500">
              {tx(lang, 'Sehife', 'Stranica', 'Page')} {currentPage} / {totalPages}
              <span className="ml-2 text-slate-600">
                ({filteredRows.length} {tx(lang, 'netice', 'rezultatov', 'results')})
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="rounded-lg border border-white/10 bg-slate-800/80 px-3.5 py-1.5 text-xs font-semibold text-slate-300 transition-all hover:border-white/20 hover:bg-slate-700/80 disabled:cursor-not-allowed disabled:opacity-30"
              >
                &larr; {tx(lang, 'Evvelki', 'Predydushaya', 'Previous')}
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="rounded-lg border border-white/10 bg-slate-800/80 px-3.5 py-1.5 text-xs font-semibold text-slate-300 transition-all hover:border-white/20 hover:bg-slate-700/80 disabled:cursor-not-allowed disabled:opacity-30"
              >
                {tx(lang, 'Novbeti', 'Sleduyushaya', 'Next')} &rarr;
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

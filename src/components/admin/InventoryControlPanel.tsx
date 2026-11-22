import { inventoryMessage, inventoryMovementLabel } from '../../lib/inventoryPresentation';
import React, { useState, useRef, useEffect } from 'react';
import { apiRequest } from '../../api/client';
import { withFinanceRequestKey } from '../../lib/financeRequests';

export default function InventoryControlPanel({ items, tenantId, actor, onSaved }: { items: any[]; tenantId: string; actor: string; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState('');
  const [count, setCount] = useState('');
  const [reason, setReason] = useState('');
  const [moves, setMoves] = useState<any[]>([]);
  const [page, setPage] = useState(0);
  const [report, setReport] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const item = items.find(r => r.id === itemId);
  useEffect(() => { setReport(null); setMoves([]); setHistoryLoaded(false); setPage(0); }, [items]);
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError('');
    try { await action(); } catch (e: any) { setError(inventoryMessage(e)); } finally { busyRef.current = false; setBusy(false); }
  };
  const history = async (nextPage: number) => {
    const rows = await apiRequest<any[]>(`/api/v1/catalog/inventory/${encodeURIComponent(itemId)}/movements?limit=50&offset=${nextPage * 50}`, { tenantId: null });
    setMoves(rows); setPage(nextPage); setHistoryLoaded(true);
  };
  return (
    <section className={open ? "w-full rounded-2xl border border-slate-700/70 bg-slate-900/60 subpanel-expanded p-4 space-y-3 mt-1 shadow-sm" : "inline-block"}>
      <div className="flex items-center justify-between gap-2">
        <button
          className={`neon-btn !min-h-11 px-4 py-2 text-xs md:text-sm font-bold rounded-xl transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${open ? 'neon-chip-active font-black ring-1 ring-amber-400/50' : ''}`}
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          Sayım və anbar hərəkət jurnalı
        </button>
        {open && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="px-3 py-1.5 rounded-xl border border-slate-700/70 text-xs font-bold text-slate-400 hover:text-slate-200 transition"
          >
            ✕ Bağla
          </button>
        )}
      </div>
      {open && <>
      <p className="text-sm text-slate-300">Jurnal yeni uçotun başlanmasından sonrakı hərəkətləri göstərir. Sayım fərqi maliyyəyə yazılır. Sayım artığı və izlənməyən qaytarılmalar yoxlanana qədər karantində saxlanır.</p>
      <label className="block">Məhsul<select aria-label="Məhsul" className="neon-input w-full" value={itemId} disabled={busy} onChange={e => { setItemId(e.target.value); setMoves([]); setHistoryLoaded(false); setCount(''); setPage(0); }}><option value="">Məhsul seçin</option>{items.map(r => <option key={r.id} value={r.id}>{r.name} — {r.stock_qty} {r.unit}</option>)}</select></label>
      <button className="neon-btn px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed" disabled={!itemId || busy} onClick={() => void run(() => history(0))}>Hərəkətləri göstər</button>
      {item && <div className="space-y-3">
        <label className="block">Faktiki sayılmış miqdar ({item.unit})<input className="neon-input w-full" inputMode="decimal" value={count} onChange={e => setCount(e.target.value)} /></label>
        <label className="block">Sayımın səbəbi<input className="neon-input w-full" maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
        <p className="text-sm">Sistemdəki qalıq: {item.stock_qty}. Təsdiqdən sonra sayım fərqi və maliyyə yazılışı birlikdə saxlanır.</p>
        <button className="neon-btn px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed" disabled={busy || !/^\d+(\.\d{1,3})?$/.test(count) || reason.trim().length < 3} onClick={() => void run(async () => {
          const payload = { counted_qty: count, expected_qty: String(item.stock_qty), reason: reason.trim() };
          await withFinanceRequestKey(tenantId, actor, 'inventory:count', { itemId, ...payload }, key => apiRequest(`/api/v1/catalog/inventory/${encodeURIComponent(itemId)}/count`, { method: 'POST', tenantId: null, body: { ...payload, idempotency_key: key } }));
          setCount(''); setReason(''); setReport(null); await onSaved(); await history(0);
        })}>Sayımı və maliyyə fərqini təsdiqlə</button>
      </div>}
      {historyLoaded && moves.length === 0 && <p role="status">Bu səhifədə anbar hərəkəti yoxdur.</p>}
      {moves.length > 0 && <p className="text-xs text-slate-400">Cədvəli sağa sürüşdürərək bütün sütunlara baxın.</p>}
      {moves.length > 0 && <div className="overflow-x-auto" role="region" aria-label="Anbar hərəkətləri" tabIndex={0}><table className="w-full min-w-[640px] text-left text-sm [&_th]:px-3 [&_td]:px-3 [&_td]:py-2"><thead><tr><th>Tarix</th><th>Əvvəl</th><th>Dəyişmə</th><th>Sonra</th><th>Səbəb</th></tr></thead><tbody>{moves.map(r => <tr key={r.id}><td>{new Date(r.created_at).toLocaleString()}</td><td>{r.quantity_before}</td><td>{r.difference}</td><td>{r.quantity_after}</td><td>{inventoryMovementLabel(r)}</td></tr>)}</tbody></table></div>}
      <div className="flex gap-2"><button disabled={busy || !itemId || page === 0} onClick={() => void run(() => history(page-1))}>Əvvəlki</button><button disabled={busy || !itemId || moves.length < 50} onClick={() => void run(() => history(page+1))}>Növbəti</button></div>
      <button className="neon-btn px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed" disabled={busy} onClick={() => void run(async () => setReport(await apiRequest('/api/v1/catalog/inventory-reconciliation', { tenantId: null })))}>Anbarı maliyyə ilə tutuşdur</button>
      {report && <div role="status"><p>Anbar dəyəri: {report.stock_value} ₼ · Maliyyə: {report.ledger_value} ₼ · Fərq: {report.value_difference} ₼</p><p>{report.balanced ? 'Qalıqlar uyğundur' : `Araşdırılmalı fərq var. Miqdar fərqi olan məhsullar: ${report.quantity_differences.length}`}</p><p>İlkin maya dəyəri: {report.historical_cost_value} ₼ · Dəyərsizləşmə fərqi: {report.valuation_reduction} ₼</p><p>Partiya ilə miqdar fərqi: {report.batch_differences?.length || 0} məhsul.</p><p>{report.note}</p>{report.quantity_differences.map((r: any) => <p key={r.item_id}>{r.name}: sistem {r.stock_qty}, jurnal {r.journal_qty}</p>)}</div>}
      {error && <p role="alert" className="text-red-300">{error}</p>}
    </>}
    </section>
  );
}

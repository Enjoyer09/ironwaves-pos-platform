import { inventoryMessage } from '../../lib/inventoryPresentation';
import React, { useEffect, useRef, useState } from 'react';
import { Decimal } from 'decimal.js';
import { apiRequest } from '../../api/client';
import { withFinanceRequestKey } from '../../lib/financeRequests';

const inputNumber = (value: string, places: number) => new RegExp(`^\\d+(?:[.,]\\d{1,${places}})?$`).test(value.trim());
const normalized = (value: string) => value.trim().replace(',', '.');
const button = 'neon-btn !min-h-11 px-4 py-2 text-xs md:text-sm font-bold rounded-xl transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed';

export default function InventoryLifecyclePanel({ items, tenantId, actor, onSaved }: { items: any[]; tenantId: string; actor: string; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState('');
  const [data, setData] = useState<any>(null);
  const [page, setPage] = useState(0);
  const [valuationPage, setValuationPage] = useState(0);
  const [valuations, setValuations] = useState<any[] | null>(null);
  const [allocations, setAllocations] = useState<any[] | null>(null);
  const [allocationPage, setAllocationPage] = useState(0);
  const [selected, setSelected] = useState<any>(null);
  const [lot, setLot] = useState('');
  const [expiry, setExpiry] = useState('');
  const [status, setStatus] = useState('quarantine');
  const [reason, setReason] = useState('');
  const [discardQty, setDiscardQty] = useState('');
  const [nrv, setNrv] = useState('');
  const [valuationReason, setValuationReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const busyRef = useRef(false);
  const item = items.find(r => r.id === itemId);
  useEffect(() => { setData(null); setSelected(null); setAllocations(null); setValuations(null); setPage(0); setValuationPage(0); setNrv(''); setValuationReason(''); setMessage(''); setError(''); }, [itemId, item?.stock_qty, item?.unit_cost, item?.expiry_required, item?.legacy_negative_allowed]);
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (e: any) { setError(inventoryMessage(e)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const loadBatches = async (nextPage = 0) => {
    const result = await apiRequest(`/api/v1/catalog/inventory/${encodeURIComponent(itemId)}/batches?limit=50&offset=${nextPage*50}`, { tenantId: null });
    setData(result); setPage(nextPage);
  };
  const loadValuations = async (nextPage = 0) => {
    setValuations(await apiRequest<any[]>(`/api/v1/catalog/inventory/${encodeURIComponent(itemId)}/valuations?limit=50&offset=${nextPage*50}`, { tenantId: null })); setValuationPage(nextPage);
  };
  const loadAllocations = async (batchId: string, nextPage = 0) => {
    setAllocations(await apiRequest<any[]>(`/api/v1/catalog/inventory/${encodeURIComponent(itemId)}/batches/${encodeURIComponent(batchId)}/movements?limit=50&offset=${nextPage*50}`, { tenantId: null })); setAllocationPage(nextPage);
  };
  let preview: string | null = null;
  if (item && inputNumber(nrv, 4)) {
    const target = Decimal.min(new Decimal(item.cost_basis_unit_cost || item.unit_cost), new Decimal(normalized(nrv)));
    const difference = target.minus(item.unit_cost).mul(item.stock_qty);
    preview = `Yeni uçot dəyəri: ${target.toFixed(4)} ₼ / ${item.unit}. ${difference.lt(0) ? 'Dəyərsizləşmə xərci' : 'Əvvəlki dəyərsizləşmənin bərpası'}: ${difference.abs().toFixed(2)} ₼.`;
  }
  return (
    <section className={open ? "w-full rounded-2xl border border-slate-700/70 bg-slate-900/60 subpanel-expanded p-4 space-y-3 mt-1 shadow-sm" : "inline-block"}>
      <div className="flex items-center justify-between gap-2">
        <button className={`${button} ${open ? 'neon-chip-active font-black ring-1 ring-amber-400/50' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
          Partiyalar, FEFO və dəyərsizləşmə
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
      <p className="text-sm text-slate-300">Satışda əvvəl son istifadə tarixi daha yaxın olan yararlı partiya silinir. Karantin və vaxtı keçmiş partiyalar satışa çıxmır. Son istifadə tarixi həmin günün sonunadək keçərlidir.</p>
      <label className="block">Uçot məhsulu<select aria-label="Uçot məhsulu" className="neon-input w-full" disabled={busy} value={itemId} onChange={e => setItemId(e.target.value)}><option value="">Məhsul seçin</option>{items.map(r => <option key={r.id} value={r.id}>{r.name} — {r.stock_qty} {r.unit}</option>)}</select></label>
      {item && <>
        <p>İlkin maya bazası: {item.cost_basis_unit_cost} ₼ / {item.unit}. Cari uçot dəyəri: {item.unit_cost} ₼ / {item.unit}.</p>
        <p className="text-sm text-slate-300">Tarix tələbi: {item.expiry_required ? 'məcburidir' : 'məcburi deyil'}. Məcburi olduqda tarixi bilinməyən partiyalar satışa çıxmır.</p>
        <button className={button} disabled={busy} onClick={() => void run(async () => {
          await apiRequest(`/api/v1/catalog/inventory/${encodeURIComponent(itemId)}`, { method: 'PUT', tenantId: null, body: { expiry_required: !item.expiry_required } });
          await onSaved(); setMessage('Son istifadə tarixi qaydası saxlanıldı.');
        })}>{item.expiry_required ? 'Tarix tələbini söndür' : 'Son istifadə tarixini məcburi et'}</button>
        <p className="text-sm text-slate-300">{item.legacy_negative_allowed ? 'Köhnə qalıq rejimi açıqdır: yalnız tarixsiz və karantinsiz məhsulda əvvəlki mənfi qalıq qaydası saxlanır. Tarixli partiyalar bu güzəştdən istifadə etmir.' : 'Satışa yararlı qalıq çatmadıqda satış bloklanır.'}</p>
        <button className={button} disabled={busy} onClick={() => void run(async () => {
          await apiRequest(`/api/v1/catalog/inventory/${encodeURIComponent(itemId)}`, { method: 'PUT', tenantId: null, body: { legacy_negative_allowed: !item.legacy_negative_allowed } });
          await onSaved(); setMessage('Qalıq siyasəti saxlanıldı.');
        })}>{item.legacy_negative_allowed ? 'Mənfi qalıqla satışı blokla' : 'Tarixsiz məhsul üçün köhnə rejimə icazə ver'}</button>
        <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => void run(() => loadBatches())}>Partiyaları göstər</button><button className={button} disabled={busy} onClick={() => void run(() => loadValuations())}>Dəyərsizləşmə tarixçəsi</button></div>
      </>}
      {data && <>
        <p role="status">Sistem: {data.stock_qty} · Partiyalar: {data.batch_qty} · Satışa yararlı: {data.sale_eligible_qty} {item?.unit}</p>
        <p>Vaxtı keçmiş: {data.expired_qty} · Karantin: {data.quarantine_qty} · Tarixi bilinməyən: {data.undated_qty}. Bu göstəricilər üst-üstə düşə bilər.</p>
        <div className="overflow-x-auto" role="region" aria-label="Partiya siyahısı" tabIndex={0}><table className="w-full min-w-[740px] text-left text-sm [&_td]:px-3 [&_td]:py-2 [&_th]:px-3"><thead><tr><th>Partiya / təchizatçı</th><th>Son istifadə</th><th>Qalıq</th><th>Vəziyyət</th><th>Əməliyyat</th></tr></thead><tbody>{data.items.map((b: any) => <tr key={b.id}><td>{b.lot_code || 'Nömrə verilməyib'}<div className="text-xs text-slate-400">{b.supplier_name || 'Təchizatçı qeyd olunmayıb'}{b.invoice_no ? ` · Faktura ${b.invoice_no}` : ''}</div></td><td>{b.expires_on || 'Tarix bilinmir'}</td><td>{b.quantity_remaining}</td><td>{b.expired ? 'Vaxtı keçib' : b.status === 'quarantine' ? 'Karantin' : b.sale_eligible ? 'Satışa yararlı' : 'Satışa bağlı'}</td><td><button className={button} disabled={busy} onClick={() => { setSelected(b); setLot(b.lot_code || ''); setExpiry(b.expires_on || ''); setStatus(b.status); setReason(''); setDiscardQty(''); setAllocations(null); }}>Partiyanı idarə et</button></td></tr>)}</tbody></table></div>
        {data.items.length === 0 && <p>Bu səhifədə partiya yoxdur.</p>}
        <div className="flex gap-3"><button disabled={busy || page === 0} onClick={() => void run(() => loadBatches(page-1))}>Əvvəlki partiyalar</button><button disabled={busy || (page+1)*50 >= data.total} onClick={() => void run(() => loadBatches(page+1))}>Növbəti partiyalar</button></div>
      </>}
      {selected && <div className="space-y-3 border border-amber-300/30 p-3 rounded-lg">
        <p>Seçilmiş partiya: {selected.lot_code || selected.id} · qalıq {selected.quantity_remaining} {item?.unit}</p>
        <label className="block">Partiya kodu<input className="neon-input w-full" maxLength={120} value={lot} onChange={e => setLot(e.target.value)} /></label>
        <label className="block">Yoxlanmış son istifadə tarixi<input type="date" className="neon-input w-full" value={expiry} onChange={e => setExpiry(e.target.value)} /></label>
        <label className="block">Partiya statusu<select aria-label="Partiya statusu" className="neon-input w-full" value={status} onChange={e => setStatus(e.target.value)}><option value="available">Satışa yararlı</option><option value="quarantine">Karantin</option></select></label>
        <label className="block">Partiya əməliyyatının səbəbi<input className="neon-input w-full" maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
        <button className={button} disabled={busy || reason.trim().length < 3} onClick={() => void run(async () => {
          await apiRequest(`/api/v1/catalog/inventory/${encodeURIComponent(itemId)}/batches/${encodeURIComponent(selected.id)}`, { method: 'PUT', tenantId: null, body: { lot_code: lot.trim() || null, expires_on: expiry || null, status, expected_version: selected.version, reason: reason.trim() } });
          setSelected(null); await loadBatches(page); setMessage('Partiya məlumatları saxlanıldı.');
        })}>Tarix və statusu saxla</button>
        <label className="block">Partiyadan itkiyə silinəcək miqdar<input className="neon-input w-full" inputMode="decimal" value={discardQty} onChange={e => setDiscardQty(e.target.value)} /></label>
        <p className="text-sm">Təsdiqdən sonra yalnız bu partiyanın miqdarı azalacaq və itki maliyyəyə yazılacaq.</p>
        <button className={button} disabled={busy || reason.trim().length < 3 || !inputNumber(discardQty, 3) || !new Decimal(normalized(discardQty) || 0).gt(0)} onClick={() => void run(async () => {
          const payload = { batch_id: selected.id, qty_removed: normalized(discardQty), reason: reason.trim() };
          await withFinanceRequestKey(tenantId, actor, 'inventory:batch-loss', { itemId, ...payload }, key => apiRequest(`/api/v1/catalog/inventory/${encodeURIComponent(itemId)}/loss`, { method: 'POST', tenantId: null, body: { ...payload, idempotency_key: key } }));
          setSelected(null); await onSaved(); await loadBatches(); setMessage('Partiya itkisi və maliyyə yazılışı saxlanıldı.');
        })}>Seçilmiş miqdarı itkiyə yaz</button>
        <button className={button} disabled={busy} onClick={() => void run(() => loadAllocations(selected.id))}>Partiyanın hərəkətlərini göstər</button>
        {allocations && <><div className="overflow-x-auto"><table className="w-full min-w-[500px] text-left text-sm [&_td]:p-2"><thead><tr><th>Tarix</th><th>Dəyişmə</th><th>Son qalıq</th></tr></thead><tbody>{allocations.map(r => <tr key={r.id}><td>{new Date(r.created_at).toLocaleString()}</td><td>{r.quantity_delta}</td><td>{r.balance_after}</td></tr>)}</tbody></table></div><button disabled={busy || allocationPage === 0} onClick={() => void run(() => loadAllocations(selected.id, allocationPage-1))}>Əvvəlki hərəkətlər</button><button disabled={busy || allocations.length < 50} onClick={() => void run(() => loadAllocations(selected.id, allocationPage+1))}>Növbəti hərəkətlər</button></>}
        <button className={button} disabled={busy} onClick={() => setSelected(null)}>Partiya seçimini bağla</button>
      </div>}
      {item && <div className="space-y-3 border border-slate-600 p-3 rounded-lg">
        <p className="font-semibold">Bütün məhsul qalığının dəyərsizləşməsi / bərpası</p>
        <p className="text-sm text-slate-300">Xalis realizasiya dəyəri gözlənən satış qiymətindən tamamlama və satış xərcləri çıxıldıqdan sonra qalan məbləğdir. Bərpa ilkin maya bazasını keçmir. Bu əməliyyat miqdarı dəyişmir.</p>
        <label className="block">Xalis realizasiya dəyəri (₼ / {item.unit})<input className="neon-input w-full" inputMode="decimal" value={nrv} onChange={e => setNrv(e.target.value)} /></label>
        <label className="block">Qiymətləndirmənin səbəbi<input className="neon-input w-full" maxLength={500} value={valuationReason} onChange={e => setValuationReason(e.target.value)} /></label>
        {preview && <p role="status">{preview}</p>}
        <button className={button} disabled={busy || !inputNumber(nrv, 4) || Number(item.stock_qty) <= 0 || valuationReason.trim().length < 3} onClick={() => void run(async () => {
          const payload = { nrv_unit_cost: normalized(nrv), expected_qty: String(item.stock_qty), expected_unit_cost: String(item.unit_cost), reason: valuationReason.trim() };
          const result = await withFinanceRequestKey(tenantId, actor, 'inventory:valuation', { itemId, ...payload }, key => apiRequest<any>(`/api/v1/catalog/inventory/${encodeURIComponent(itemId)}/valuation`, { method: 'POST', tenantId: null, body: { ...payload, idempotency_key: key } }));
          await onSaved(); await loadValuations(); setNrv(''); setValuationReason(''); setMessage(result.changed ? 'Qiymətləndirmə və maliyyə yazılışı saxlanıldı.' : 'Uçot dəyəri dəyişməyib; əlavə maliyyə yazılışı yaradılmadı.');
        })}>Qiymətləndirməni maliyyəyə yaz</button>
      </div>}
      {valuations && <><div className="overflow-x-auto" role="region" aria-label="Qiymətləndirmə tarixçəsi" tabIndex={0}><table className="w-full min-w-[680px] text-left text-sm [&_td]:p-2"><thead><tr><th>Tarix</th><th>Əvvəlki vahid dəyər</th><th>Yeni vahid dəyər</th><th>Məbləğ</th><th>Səbəb</th></tr></thead><tbody>{valuations.map(v => <tr key={v.id}><td>{new Date(v.created_at).toLocaleString()}</td><td>{v.previous_unit_cost}</td><td>{v.new_unit_cost}</td><td>{v.kind === 'reversal' ? 'Bərpa' : 'Xərc'} {v.amount} ₼</td><td>{v.reason}</td></tr>)}</tbody></table></div>{valuations.length === 0 && <p>Qiymətləndirmə qeydi yoxdur.</p>}<button disabled={busy || valuationPage === 0} onClick={() => void run(() => loadValuations(valuationPage-1))}>Əvvəlki qiymətləndirmələr</button><button disabled={busy || valuations.length < 50} onClick={() => void run(() => loadValuations(valuationPage+1))}>Növbəti qiymətləndirmələr</button></>}
      {message && <p role="status" className="text-emerald-200">{message}</p>}
      {error && <p role="alert" className="text-red-300">{error}</p>}
    </>}
    </section>
  );
}

import { inventoryMessage } from '../../lib/inventoryPresentation';
import React, { useRef, useState } from 'react';
import { apiRequest } from '../../api/client';

export default function RecipeLinkReview({ items }: { items: any[] }) {
  const [issues, setIssues] = useState<any[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [menus, setMenus] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [inventoryId, setInventoryId] = useState('');
  const [menuId, setMenuId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const load = async (next = 0) => {
    const [data, menu] = await Promise.all([apiRequest<any>(`/api/v1/catalog/recipe-link-issues?limit=50&offset=${next}`, { tenantId: null }), apiRequest<any[]>('/api/v1/catalog/menu', { tenantId: null })]);
    setIssues(data.items); setTotal(data.total); setMenus(menu); setOffset(next);
  };
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await action(); } catch (e: any) { setError(inventoryMessage(e)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  return <section className="metal-panel p-4 space-y-3">
    <button className="neon-btn px-4 py-2" disabled={busy} onClick={() => void run(() => load())}>Resept əlaqələrini yoxla</button>
    {total !== null && <p role="status">Yoxlanmalı resept əlaqəsi: {total}. Avtomatik seçim edilmir.</p>}
    {issues.map(row => <div key={row.recipe_id} className="flex flex-wrap gap-3 items-center"><span>{row.menu_item_name} → {row.ingredient_name}</span><button className="neon-btn px-3 py-2" disabled={busy} onClick={() => { setSelected(row); setInventoryId(row.inventory_item_id || ''); setMenuId(row.menu_item_id || ''); setReason(''); }}>Əlaqəni seç</button></div>)}
    {total !== null && <div className="flex gap-3"><button disabled={busy || offset === 0} onClick={() => void run(() => load(Math.max(0, offset-50)))}>Əvvəlki əlaqələr</button><button disabled={busy || offset+50 >= total} onClick={() => void run(() => load(offset+50))}>Növbəti əlaqələr</button></div>}
    {selected && <div className="space-y-3 border border-amber-300/30 rounded-lg p-3">
      <p>{selected.menu_item_name} → {selected.ingredient_name}. Miqdar mövcud əsas ölçü vahidində saxlanır.</p>
      <label className="block">Xammal əlaqəsi<select aria-label="Xammal əlaqəsi" className="neon-input w-full" value={inventoryId} onChange={e => setInventoryId(e.target.value)}><option value="">Xammalı seçin</option>{items.map(r => <option value={r.id} key={r.id}>{r.name} · {r.unit} · qalıq {r.stock_qty} · {r.id}</option>)}</select></label>
      <label className="block">Menyu əlaqəsi<select aria-label="Menyu əlaqəsi" className="neon-input w-full" value={menuId} onChange={e => setMenuId(e.target.value)}><option value="">Menyunu seçin</option>{menus.map(r => <option value={r.id} key={r.id}>{r.item_name} · {r.id}</option>)}</select></label>
      <label className="block">Əlaqə düzəlişinin səbəbi<input className="neon-input w-full" maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <button className="neon-btn px-4 py-2" disabled={busy || !inventoryId || !menuId || reason.trim().length < 3} onClick={() => void run(async () => {
        await apiRequest(`/api/v1/catalog/recipe-links/${encodeURIComponent(selected.recipe_id)}`, { method: 'PUT', tenantId: null, body: { inventory_item_id: inventoryId, menu_item_id: menuId, reason: reason.trim() } });
        setSelected(null); await load();
      })}>Seçilmiş əlaqəni təsdiqlə</button>
      <button className="neon-btn px-4 py-2" disabled={busy} onClick={() => setSelected(null)}>Ləğv et</button>
    </div>}
    {error && <p role="alert" className="text-red-300">{error}</p>}
  </section>;
}

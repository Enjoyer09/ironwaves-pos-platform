import React from 'react';
import { get_public_receipt } from '../api/pos';
import { get_business_profile } from '../api/settings';

type Props = {
  receiptId: string;
  token: string;
};

export default function PublicReceipt({ receiptId, token }: Props) {
  const receipt = get_public_receipt(receiptId, token);

  if (!receipt) {
    return (
      <div className="min-h-screen bg-[#0f1722] p-6 text-slate-200">
        <div className="mx-auto max-w-xl rounded-xl border border-slate-700 bg-[#101722] p-6 text-center">
          <h1 className="text-xl font-semibold">Receipt not found</h1>
          <p className="mt-2 text-sm text-slate-400">Please check the QR code and try again.</p>
        </div>
      </div>
    );
  }

  const profile = get_business_profile(receipt.tenant_id);

  return (
    <div className="min-h-screen bg-[#0f1722] p-6 text-slate-200">
      <div className="mx-auto max-w-xl rounded-xl border border-slate-700 bg-[#101722] p-6">
        <div className="mb-4 flex items-center gap-3 border-b border-slate-700 pb-4">
          {profile?.logo_url ? (
            <img src={profile.logo_url} alt="logo" className="h-10 w-10 rounded-lg object-cover" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-400 font-bold text-slate-900">SB</div>
          )}
          <div>
            <h1 className="text-lg font-bold">{profile?.company_name || 'IRONWAVES POS'}</h1>
            <p className="text-xs text-slate-400">Receipt #{receipt.id.slice(0, 8).toUpperCase()}</p>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 text-sm text-slate-300">
          <div>Date</div>
          <div className="text-right">{new Date(receipt.created_at).toLocaleString()}</div>
          <div>Cashier</div>
          <div className="text-right">{receipt.cashier}</div>
          <div>Payment</div>
          <div className="text-right">{receipt.payment_method}</div>
          <div>Status</div>
          <div className="text-right">{receipt.status}</div>
          {receipt.customer_card_id ? (
            <>
              <div>Customer ID</div>
              <div className="text-right">{receipt.customer_card_id}</div>
              <div>Star Balance</div>
              <div className="text-right">{Number(receipt.customer_stars_after || 0)}</div>
            </>
          ) : null}
        </div>

        <div className="mb-4 rounded-lg border border-slate-700 bg-[#0d141e] p-3">
          {(receipt.items || []).map((item: any, idx: number) => (
            <div key={`${item.item_name}_${idx}`} className="mb-1 flex items-center justify-between text-sm">
              <span>
                {item.qty}x {item.item_name}
              </span>
              <span>{(Number(item.price || 0) * Number(item.qty || 0)).toFixed(2)} ₼</span>
            </div>
          ))}
        </div>

        <div className="space-y-1 border-t border-slate-700 pt-3 text-sm">
          <div className="flex justify-between text-slate-300">
            <span>Subtotal</span>
            <span>{Number(receipt.original_total || 0).toFixed(2)} ₼</span>
          </div>
          <div className="flex justify-between text-slate-300">
            <span>Discount</span>
            <span>- {Number(receipt.discount_amount || 0).toFixed(2)} ₼</span>
          </div>
          {Number(receipt.free_coffees_applied || 0) > 0 ? (
            <div className="flex justify-between text-emerald-300">
              <span>Free coffee</span>
              <span>{Number(receipt.free_coffees_applied || 0)}</span>
            </div>
          ) : null}
          <div className="flex justify-between text-lg font-bold text-white">
            <span>Total</span>
            <span>{Number(receipt.total || 0).toFixed(2)} ₼</span>
          </div>
        </div>
      </div>
    </div>
  );
}

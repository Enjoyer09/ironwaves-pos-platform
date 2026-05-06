import React from 'react';
import { get_public_receipt_live } from '../api/pos';
import { get_business_profile, get_public_branding_live, get_settings } from '../api/settings';
import { formatServerUtcDateTime } from '../lib/time';
import { buildSaleReceiptHtml } from '../lib/receipt_html';

type Props = {
  receiptId: string;
  token: string;
};

const isVoidSaleStatus = (status: unknown) => [
  'VOIDED',
  'VOID',
  'CANCELLED',
  'CANCELED',
  'CANCELLED SALE',
  'CANCELED SALE',
  'LƏĞV',
  'LƏĞV EDILDI',
  'LƏĞV EDİLDİ',
  'LAGV',
  'LAGV EDILDI',
].includes(String(status || '').trim().toUpperCase());

export default function PublicReceipt({ receiptId, token }: Props) {
  const [receipt, setReceipt] = React.useState<any | null>(null);
  const [profile, setProfile] = React.useState<any>(null);
  const [feedback, setFeedback] = React.useState<{ label: string; url: string } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const receiptIframeRef = React.useRef<HTMLIFrameElement | null>(null);

  React.useEffect(() => {
    let mounted = true;
    const fallbackKey = `receipt_fallback:${String(receiptId || '').trim()}:${String(token || '').trim()}`;
    void (async () => {
      try {
        const rawFallback = sessionStorage.getItem(fallbackKey);
        const parsedFallback = rawFallback ? JSON.parse(rawFallback) : null;
        const res = await get_public_receipt_live(receiptId, token);
        if (!mounted) return;
        const nextProfile = await get_public_branding_live(res.tenant_id).catch(() => get_business_profile(res.tenant_id));
        setProfile(nextProfile);
        const settings = get_settings(res.tenant_id);
        const feedbackSettings = settings?.feedback_settings || {};
        const defaultFeedbackPortalUrl = `${window.location.origin.replace(/\/+$/, '')}/feedback`;
        const baseFeedbackUrl = String(feedbackSettings.portal_url || defaultFeedbackPortalUrl || feedbackSettings.google_review_url || '').trim();
        const feedbackEnabled = feedbackSettings.enabled === true && Boolean(baseFeedbackUrl);
        let nextFeedbackUrl = '';
        if (feedbackEnabled && baseFeedbackUrl) {
          nextFeedbackUrl = baseFeedbackUrl;
          try {
            const url = new URL(baseFeedbackUrl);
            url.searchParams.set('tenant_id', String(res.tenant_id || ''));
            url.searchParams.set('receipt_id', String(res.id || receiptId || ''));
            url.searchParams.set('r', String(receiptId || res.id || ''));
            url.searchParams.set('t', String(token || ''));
            nextFeedbackUrl = url.toString();
          } catch {
            nextFeedbackUrl = baseFeedbackUrl;
          }
          setFeedback({
            label: String(feedbackSettings.receipt_button_text_az || 'Rəy bildirin'),
            url: nextFeedbackUrl,
          });
        } else {
          setFeedback(null);
        }
        const receiptData = {
          ...(parsedFallback || {}),
          ...res,
          split_cash: res?.split_cash ?? parsedFallback?.split_cash ?? null,
          split_card: res?.split_card ?? parsedFallback?.split_card ?? null,
        };
        const shouldRegenerateFromFallback = Boolean(
          parsedFallback &&
          (
            parsedFallback.payment_method ||
            parsedFallback.split_cash ||
            parsedFallback.split_card ||
            parsedFallback.receipt_html
          )
        );
        const forceFreshReceipt = new URLSearchParams(window.location.search).get('fresh') === '1';
        const savedHtml = String(res?.receipt_html || '').trim();
        const fallbackHtml = String(parsedFallback?.receipt_html || '').trim();
        const generatedHtml = () => buildSaleReceiptHtml({
          sale: receiptData,
          profile: nextProfile,
          lang: 'az',
          receiptUrl: window.location.href,
          feedbackUrl: nextFeedbackUrl,
          operator: String(receiptData?.cashier || ''),
        });
        const receiptHtml = forceFreshReceipt || shouldRegenerateFromFallback
          ? await generatedHtml()
          : savedHtml || fallbackHtml || await generatedHtml();
        setReceipt({ ...receiptData, receipt_html: receiptHtml });
      } catch {
        if (!mounted) return;
        try {
          const raw = sessionStorage.getItem(fallbackKey);
          const parsed = raw ? JSON.parse(raw) : null;
          if (parsed) {
            setReceipt(parsed);
            setFeedback(null);
          } else {
            setReceipt(null);
            setFeedback(null);
          }
        } catch {
          setReceipt(null);
          setFeedback(null);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [receiptId, token]);

  React.useEffect(() => {
    if (loading || !receipt) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('autoprint') !== '1') return;
    const timer = window.setTimeout(() => {
      if (receipt?.receipt_html && receiptIframeRef.current?.contentWindow) {
        receiptIframeRef.current.contentWindow.focus();
        receiptIframeRef.current.contentWindow.print();
        return;
      }
      window.print();
    }, 450);
    return () => window.clearTimeout(timer);
  }, [loading, receipt]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0f1722] p-6 text-slate-200">
        <div className="mx-auto max-w-xl rounded-xl border border-slate-700 bg-[#101722] p-6 text-center">
          <h1 className="text-xl font-semibold">Loading receipt...</h1>
        </div>
      </div>
    );
  }

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

  if (receipt?.receipt_html) {
    return (
      <div className="min-h-screen bg-[#0f1722] p-4">
        <div className="mx-auto max-w-xl rounded-xl border border-slate-700 bg-[#101722] p-3">
          <iframe
            ref={receiptIframeRef}
            title="receipt-html"
            srcDoc={receipt.receipt_html}
            className="h-[80vh] w-full rounded-lg bg-white"
          />
        </div>
      </div>
    );
  }

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
          <div className="text-right">{formatServerUtcDateTime(receipt.created_at, 'az')}</div>
          <div>Cashier</div>
          <div className="text-right">{receipt.cashier}</div>
          <div>Payment</div>
          <div className="text-right">{isVoidSaleStatus(receipt.status) ? 'Ləğv edildi' : receipt.payment_method}</div>
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
          {Number(receipt.service_fee_amount || 0) > 0 ? (
            <div className="flex justify-between text-slate-300">
              <span>Service fee</span>
              <span>{Number(receipt.service_fee_amount || 0).toFixed(2)} ₼</span>
            </div>
          ) : null}
          {Number(receipt.deposit_amount || 0) > 0 ? (
            <div className="flex justify-between text-slate-300">
              <span>Deposit</span>
              <span>{Number(receipt.deposit_amount || 0).toFixed(2)} ₼</span>
            </div>
          ) : null}
          {Number(receipt.extra_due || 0) > 0 ? (
            <div className="flex justify-between text-slate-300">
              <span>Extra due</span>
              <span>{Number(receipt.extra_due || 0).toFixed(2)} ₼</span>
            </div>
          ) : null}
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
        {feedback?.url ? (
          <a
            href={feedback.url}
            target="_blank"
            rel="noreferrer"
            className="mt-4 block rounded-lg border border-yellow-300/50 bg-yellow-400/15 px-4 py-3 text-center text-sm font-semibold text-yellow-200 hover:bg-yellow-400/25"
          >
            {feedback.label}
          </a>
        ) : null}
      </div>
    </div>
  );
}

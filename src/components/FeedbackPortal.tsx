import React from 'react';
import { Star } from 'lucide-react';
import { get_business_profile, get_public_branding_live, get_settings } from '../api/settings';
import { get_feedback_coupon_for_receipt_live, submit_feedback_live } from '../api/feedback';
import QRCode from 'qrcode';

type Props = {
  tenantId?: string;
  saleId?: string;
  receiptId?: string;
  receiptToken?: string;
  source?: string;
};

export default function FeedbackPortal({ tenantId = '', saleId = '', receiptId = '', receiptToken = '', source = 'receipt' }: Props) {
  const [profile, setProfile] = React.useState<any>(null);
  const [settings, setSettings] = React.useState<any>(null);
  const [score, setScore] = React.useState(0);
  const [comment, setComment] = React.useState('');
  const [contact, setContact] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [alreadySubmitted, setAlreadySubmitted] = React.useState(false);
  const [error, setError] = React.useState('');
  const [coupon, setCoupon] = React.useState<{ code: string; percent: number } | null>(null);
  const [couponQrDataUrl, setCouponQrDataUrl] = React.useState('');
  const [savingPng, setSavingPng] = React.useState(false);

  React.useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const currentTenant = String(tenantId || '').trim();
        if (!currentTenant) return;
        const [branding] = await Promise.all([
          get_public_branding_live(currentTenant).catch(() => get_business_profile(currentTenant)),
        ]);
        if (!mounted) return;
        setProfile(branding || null);
        setSettings(get_settings(currentTenant));
      } catch {
        if (!mounted) return;
        setProfile(null);
        setSettings(null);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [tenantId]);

  React.useEffect(() => {
    const safeTenant = String(tenantId || '').trim();
    const safeReceipt = String(receiptId || '').trim();
    const safeToken = String(receiptToken || '').trim();
    if (!safeTenant || !safeReceipt || !safeToken) return;
    const existingCoupon = get_feedback_coupon_for_receipt_live(safeTenant, safeReceipt, safeToken);
    if (existingCoupon) {
      setCoupon({ code: existingCoupon.code, percent: existingCoupon.percent });
      setAlreadySubmitted(true);
      setDone(true);
    }
  }, [tenantId, receiptId, receiptToken]);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!coupon?.code) {
        if (!cancelled) setCouponQrDataUrl('');
        return;
      }
      try {
        const payload = `IWPOS:FB:${String(coupon.code).trim().toUpperCase()}`;
        const qr = await QRCode.toDataURL(payload, { width: 220, margin: 1 });
        if (!cancelled) setCouponQrDataUrl(qr);
      } catch {
        if (!cancelled) setCouponQrDataUrl('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [coupon?.code]);

  const feedbackSettings = settings?.feedback_settings || {};
  const primaryColor = String(settings?.customer_app_settings?.primary_color || '#facc15');
  const accentColor = String(settings?.customer_app_settings?.accent_color || '#22d3ee');
  const backgroundColor = String(settings?.customer_app_settings?.background_color || '#0b1220');
  const textColor = '#e5e7eb';
  const heading = 'Rəy və məmnuniyyət sorğusu';
  const subHeading = 'Xidmət keyfiyyətini yaxşılaşdırmaq üçün 30 saniyə ayırın.';
  const lowScoreThreshold = 3;
  const requireComment = score > 0 && score <= lowScoreThreshold;
  const hasValidReceiptLink = Boolean(String(receiptId || '').trim() && String(receiptToken || '').trim());
  const canSubmit = hasValidReceiptLink && score >= 1 && (!requireComment || comment.trim().length >= 3) && !sending;
  const viewReceiptUrl =
    String(receiptId || '').trim() && String(receiptToken || '').trim()
      ? `/?r=${encodeURIComponent(String(receiptId || '').trim())}&t=${encodeURIComponent(String(receiptToken || '').trim())}`
      : '';

  const onSubmit = async () => {
    setError('');
    if (!canSubmit) return;
    try {
      setSending(true);
      const result = await submit_feedback_live({
        tenant_id: String(tenantId || 'tenant_default'),
        sale_id: String(saleId || '').trim() || undefined,
        receipt_id: String(receiptId || '').trim() || undefined,
        receipt_token: String(receiptToken || '').trim() || undefined,
        source,
        score,
        comment: comment.trim() || undefined,
        contact: contact.trim() || undefined,
      });
      if (result?.coupon_code) {
        setCoupon({
          code: String(result.coupon_code),
          percent: Number(result.coupon_percent || 5),
        });
      }
      setAlreadySubmitted(Boolean((result as any)?.already_submitted));
      setDone(true);
    } catch (e: any) {
      setError(String(e?.message || 'Feedback göndərmək alınmadı'));
    } finally {
      setSending(false);
    }
  };

  const saveCouponCardAsPng = async () => {
    if (!coupon?.code) return;
    try {
      setSavingPng(true);
      const width = 1080;
      const height = 1700;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx2d = canvas.getContext('2d');
      if (!ctx2d) throw new Error('Canvas unavailable');

      const bgGradient = ctx2d.createLinearGradient(0, 0, width, height);
      bgGradient.addColorStop(0, '#0b1220');
      bgGradient.addColorStop(1, '#111827');
      ctx2d.fillStyle = bgGradient;
      ctx2d.fillRect(0, 0, width, height);

      const cardX = 80;
      const cardY = 120;
      const cardW = width - 160;
      const cardH = height - 240;
      ctx2d.fillStyle = '#0f172a';
      ctx2d.strokeStyle = '#334155';
      ctx2d.lineWidth = 3;
      ctx2d.beginPath();
      ctx2d.roundRect(cardX, cardY, cardW, cardH, 28);
      ctx2d.fill();
      ctx2d.stroke();

      const companyName = String(profile?.company_name || 'ironWaves');
      ctx2d.fillStyle = '#e2e8f0';
      ctx2d.font = '700 52px Arial';
      ctx2d.fillText(companyName, cardX + 50, cardY + 90);

      ctx2d.fillStyle = '#94a3b8';
      ctx2d.font = '500 34px Arial';
      ctx2d.fillText('Feedback kuponu', cardX + 50, cardY + 150);

      ctx2d.fillStyle = '#22c55e';
      ctx2d.font = '700 72px Arial';
      ctx2d.fillText(`-${coupon.percent}% ENDIRIM`, cardX + 50, cardY + 265);

      ctx2d.fillStyle = '#f8fafc';
      ctx2d.font = '700 64px Arial';
      ctx2d.fillText(coupon.code, cardX + 50, cardY + 360);

      ctx2d.fillStyle = '#cbd5e1';
      ctx2d.font = '500 30px Arial';
      ctx2d.fillText('Növbəti alışda bu kodu kassada göstərin.', cardX + 50, cardY + 420);

      if (couponQrDataUrl) {
        const qrImg = new Image();
        await new Promise<void>((resolve, reject) => {
          qrImg.onload = () => resolve();
          qrImg.onerror = () => reject(new Error('QR load failed'));
          qrImg.src = couponQrDataUrl;
        });
        const qrSize = 360;
        const qrX = cardX + (cardW - qrSize) / 2;
        const qrY = cardY + 500;
        ctx2d.fillStyle = '#ffffff';
        ctx2d.fillRect(qrX - 14, qrY - 14, qrSize + 28, qrSize + 28);
        ctx2d.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
        ctx2d.fillStyle = '#94a3b8';
        ctx2d.font = '500 28px Arial';
        ctx2d.fillText('Kassada QR-i skan edin (IWPOS:FB)', cardX + 180, qrY + qrSize + 60);
      }

      const issuedAt = new Date().toLocaleString('az-AZ');
      ctx2d.fillStyle = '#64748b';
      ctx2d.font = '500 24px Arial';
      ctx2d.fillText(`Verilmə tarixi: ${issuedAt}`, cardX + 50, cardY + cardH - 70);

      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('PNG export failed');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `feedback-coupon-${coupon.code}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(String(err?.message || 'PNG faylı saxlanmadı'));
    } finally {
      setSavingPng(false);
    }
  };

  if (!tenantId) {
    return (
      <div className="metal-app flex min-h-screen items-center justify-center px-4 text-slate-200">
        <div className="metal-panel w-full max-w-xl rounded-3xl p-8 text-center">
          <h1 className="text-xl font-bold">Tenant tapılmadı</h1>
          <p className="mt-2 text-sm text-slate-400">Feedback səhifəsi üçün tenant_id lazımdır.</p>
        </div>
      </div>
    );
  }

  if (!hasValidReceiptLink) {
    return (
      <div className="metal-app flex min-h-screen items-center justify-center px-4 text-slate-200">
        <div className="metal-panel w-full max-w-xl rounded-3xl p-8 text-center">
          <h1 className="text-xl font-bold">Feedback linki etibarsızdır</h1>
          <p className="mt-2 text-sm text-slate-400">
            Bu səhifə yalnız çek üzərindəki QR linki (r+t) ilə açılmalıdır.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 py-8" style={{ background: `radial-gradient(circle at top right, ${accentColor}22, transparent 40%), ${backgroundColor}` }}>
      <div className="mx-auto w-full max-w-2xl rounded-3xl border border-slate-700/60 bg-slate-950/55 p-6 shadow-2xl">
        <div className="mb-5 flex items-center gap-3">
          {profile?.logo_url ? (
            <img src={profile.logo_url} alt="logo" className="h-11 w-11 rounded-xl object-cover ring-1 ring-white/10" />
          ) : (
            <div className="flex h-11 w-11 items-center justify-center rounded-xl font-black text-slate-900" style={{ backgroundColor: primaryColor }}>
              {(profile?.company_name || 'IW').slice(0, 1)}
            </div>
          )}
          <div>
            <h1 className="text-xl font-black" style={{ color: textColor }}>{profile?.company_name || 'ironWaves'}</h1>
            <p className="text-xs text-slate-400">{heading}</p>
          </div>
        </div>

        {done ? (
          <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-5 text-center">
            <div className="text-lg font-bold text-emerald-200">
              {alreadySubmitted ? 'Siz artıq rəy bildirmisiniz' : 'Təşəkkür edirik'}
            </div>
            <p className="mt-2 text-sm text-emerald-100/90">
              {alreadySubmitted
                ? 'Bu çek üçün endirim kuponunuz artıq yaradılıb və aşağıda göstərilir.'
                : String(feedbackSettings?.thank_you_text_az || 'Rəyiniz komanda tərəfindən nəzərdən keçiriləcək.')}
            </p>
            {coupon?.code ? (
              <div className="mt-4 rounded-xl border border-emerald-300/40 bg-emerald-400/10 p-3 text-left">
                <div className="text-xs text-emerald-100/90">Növbəti vizit üçün kupon</div>
                <div className="mt-1 text-xl font-black tracking-wider text-emerald-200">{coupon.code}</div>
                <div className="mt-1 text-xs text-emerald-100/90">POS-da kodu göstər, avtomatik {coupon.percent}% endirim tətbiq olunacaq.</div>
                {couponQrDataUrl ? (
                  <div className="mt-3 flex flex-col items-center rounded-lg border border-emerald-300/30 bg-emerald-500/10 p-2">
                    <img src={couponQrDataUrl} alt="Feedback coupon QR" className="h-28 w-28 rounded bg-white p-1" />
                    <div className="mt-2 text-[11px] text-emerald-100/90">Kassada QR-i skan edin (IWPOS:FB)</div>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={saveCouponCardAsPng}
                  disabled={savingPng}
                  className="mt-3 w-full rounded-lg border border-emerald-200/40 bg-emerald-600/20 px-3 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-600/30 disabled:opacity-60"
                >
                  {savingPng ? 'PNG hazırlanır...' : 'Kuponu PNG kimi saxla'}
                </button>
              </div>
            ) : null}
            {viewReceiptUrl ? (
              <a
                href={viewReceiptUrl}
                className="mt-4 mr-2 inline-block rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
              >
                Çeki gör
              </a>
            ) : null}
            {String(feedbackSettings?.google_review_url || '').trim() ? (
              <a
                href={String(feedbackSettings.google_review_url)}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-block rounded-xl px-4 py-2 text-sm font-semibold text-slate-900"
                style={{ backgroundColor: primaryColor }}
              >
                Google review aç
              </a>
            ) : null}
          </div>
        ) : (
          <>
            <p className="mb-4 text-sm text-slate-300">{subHeading}</p>
            <div className="mb-4 rounded-2xl border border-slate-700/60 bg-slate-900/40 p-4">
              <div className="mb-2 text-sm font-semibold text-slate-200">Qiymətləndirmə</div>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setScore(value)}
                    className="rounded-lg p-1.5 transition hover:scale-105"
                    aria-label={`rate-${value}`}
                  >
                    <Star
                      size={28}
                      fill={score >= value ? primaryColor : 'transparent'}
                      color={score >= value ? primaryColor : '#64748b'}
                    />
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm text-slate-300">
                  Şərh {requireComment ? '(mütləqdir)' : '(opsional)'}
                </label>
                <textarea
                  className="neon-input min-h-[110px] w-full"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Nəyi yaxşılaşdıraq?"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-300">Əlaqə (opsional)</label>
                <input
                  className="neon-input w-full"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="Telefon və ya email"
                />
              </div>
              {error ? <div className="text-sm text-rose-300">{error}</div> : null}
            </div>

            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit}
              className={`mt-5 w-full rounded-xl px-4 py-3 text-sm font-bold ${canSubmit ? '' : 'cursor-not-allowed opacity-55'}`}
              style={{ backgroundColor: primaryColor, color: '#0f172a' }}
            >
              {sending ? 'Göndərilir...' : 'Rəyi göndər'}
            </button>
            {viewReceiptUrl ? (
              <a
                href={viewReceiptUrl}
                className="mt-3 block text-center text-sm text-slate-300 underline decoration-dotted underline-offset-4 hover:text-white"
              >
                Çeki gör
              </a>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

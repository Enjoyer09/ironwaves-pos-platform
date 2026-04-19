import React from 'react';
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Eye,
  Info,
  SendHorizontal,
  Share2,
  Star,
} from 'lucide-react';
import { get_business_profile, get_public_branding_live, get_settings, get_settings_live } from '../api/settings';
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
  const [presetReasons, setPresetReasons] = React.useState<string[]>([]);
  const [contact, setContact] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [alreadySubmitted, setAlreadySubmitted] = React.useState(false);
  const [error, setError] = React.useState('');
  const [coupon, setCoupon] = React.useState<{ code: string; percent: number } | null>(null);
  const [couponQrDataUrl, setCouponQrDataUrl] = React.useState('');
  const [savingPng, setSavingPng] = React.useState(false);
  const [ctaPressed, setCtaPressed] = React.useState(false);
  const [ctaRipple, setCtaRipple] = React.useState(false);

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
        const liveSettings = await get_settings_live(currentTenant).catch(() => get_settings(currentTenant));
        if (!mounted) return;
        setSettings(liveSettings || get_settings(currentTenant));
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
    let cancelled = false;
    const safeTenant = String(tenantId || '').trim();
    const safeReceipt = String(receiptId || '').trim();
    const safeToken = String(receiptToken || '').trim();
    if (!safeTenant || !safeReceipt || !safeToken) return () => { cancelled = true; };
    void (async () => {
      const existingCoupon = await get_feedback_coupon_for_receipt_live(safeTenant, safeReceipt, safeToken);
      if (cancelled || !existingCoupon) return;
      setCoupon({ code: existingCoupon.code, percent: existingCoupon.percent });
      setAlreadySubmitted(true);
      setDone(true);
    })();
    return () => {
      cancelled = true;
    };
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
  const googleReviewUrl = String(
    feedbackSettings?.google_review_url ||
      profile?.google_review_url ||
      profile?.feedback_settings?.google_review_url ||
      '',
  ).trim();
  const primaryColor = String(settings?.customer_app_settings?.primary_color || '#facc15');
  const accentColor = String(settings?.customer_app_settings?.accent_color || '#22d3ee');
  const backgroundColor = String(settings?.customer_app_settings?.background_color || '#0b1220');
  const textColor = '#0F172A';
  const heading = 'Rəy və məmnuniyyət sorğusu';
  const subHeading = 'Xidmət keyfiyyətini yaxşılaşdırmaq üçün 30 saniyə ayırın.';
  const lowScoreThreshold = 3;
  const requireComment = score > 0 && score <= lowScoreThreshold;
  const hasValidReceiptLink = Boolean(String(receiptId || '').trim() && String(receiptToken || '').trim());
  const canSubmit =
    hasValidReceiptLink &&
    score >= 1 &&
    (!requireComment || comment.trim().length >= 3) &&
    !sending;
  const viewReceiptUrl =
    String(receiptId || '').trim() && String(receiptToken || '').trim()
      ? `/?r=${encodeURIComponent(String(receiptId || '').trim())}&t=${encodeURIComponent(String(receiptToken || '').trim())}`
      : '';

  const availablePresetReasons = [
    '❤️ Xidmət əla idi',
    '☕ Dad mükəmməl idi',
    '✨ Məkan çox təmiz idi',
    '👤 Personal peşəkar idi',
    '🏷️ Qiymət/dəyər çox yaxşı idi',
    '👍 Mütləq tövsiyə edərəm',
  ];
  const togglePresetReason = (label: string) => {
    setPresetReasons((prev) => (prev.includes(label) ? prev.filter((x) => x !== label) : [...prev, label]));
  };

  const onSubmit = async () => {
    setError('');
    if (!canSubmit) return;
    try {
      setCtaPressed(true);
      setCtaRipple(true);
      window.setTimeout(() => setCtaPressed(false), 160);
      window.setTimeout(() => setCtaRipple(false), 520);
      setSending(true);
      const composedComment = [
        presetReasons.length ? `[Preset səbəblər] ${presetReasons.join(', ')}` : '',
        comment.trim(),
      ]
        .filter(Boolean)
        .join('\n');
      const result = await submit_feedback_live({
        tenant_id: String(tenantId || 'tenant_default'),
        sale_id: String(saleId || '').trim() || undefined,
        receipt_id: String(receiptId || '').trim() || undefined,
        receipt_token: String(receiptToken || '').trim() || undefined,
        source,
        score,
        comment: composedComment || undefined,
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
      const filename = `feedback-coupon-${coupon.code}.png`;
      const canUseNativeShare =
        typeof navigator !== 'undefined' &&
        typeof (navigator as any).share === 'function' &&
        typeof (navigator as any).canShare === 'function';
      if (canUseNativeShare) {
        const file = new File([blob], filename, { type: 'image/png' });
        const canShareFile = (navigator as any).canShare({ files: [file] });
        if (canShareFile) {
          await (navigator as any).share({
            title: 'Feedback Kuponu',
            text: 'Kuponu Photos qalereyasına yadda saxlayın.',
            files: [file],
          });
          return;
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
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
      <div className="min-h-screen bg-slate-950 p-4">
        <div className="mx-auto w-full max-w-md rounded-[28px] border border-white/20 bg-white/20 p-8 text-center text-slate-900 backdrop-blur-2xl">
          <h1 className="text-xl font-bold">Tenant tapılmadı</h1>
          <p className="mt-2 text-sm text-slate-600">Feedback səhifəsi üçün tenant_id lazımdır.</p>
        </div>
      </div>
    );
  }

  if (!hasValidReceiptLink) {
    return (
      <div className="min-h-screen bg-slate-950 p-4">
        <div className="mx-auto w-full max-w-md rounded-[28px] border border-white/20 bg-white/20 p-8 text-center text-slate-900 backdrop-blur-2xl">
          <h1 className="text-xl font-bold">Feedback linki etibarsızdır</h1>
          <p className="mt-2 text-sm text-slate-600">
            Bu səhifə yalnız çek üzərindəki QR linki (r+t) ilə açılmalıdır.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative min-h-screen overflow-hidden px-3 pb-28 pt-5"
      style={{
        background:
          'linear-gradient(155deg, #8ec5ff 0%, #a48bff 28%, #ef8cf9 57%, #ffb58f 100%)',
      }}
    >
      <div className="blob-wave blob-wave-a" />
      <div className="blob-wave blob-wave-b" />
      <div className="blob-wave blob-wave-c" />

      <div className="mx-auto w-full max-w-[430px]">
        <div className="glass-card relative overflow-hidden rounded-[30px] p-5 text-slate-900">
          <div className="glass-inner-highlight" />

          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-yellow-400 font-black text-slate-900 shadow-[0_8px_24px_rgba(234,179,8,0.38)]">
                D
              </div>
              <div>
                <h1 className="text-[22px] font-extrabold leading-tight" style={{ color: textColor }}>
                  Daily Coffee & Drinks
                </h1>
                <p className="text-[12px] font-medium text-slate-600">{heading}</p>
              </div>
            </div>
            <div className="glass-bubble flex h-14 w-14 items-center justify-center rounded-full text-2xl">
              ☕
            </div>
          </div>
          <div className="glass-pill mb-4 flex items-start gap-2 rounded-2xl px-3 py-2.5">
            <Info size={15} className="mt-0.5 shrink-0 text-slate-600" />
            <p className="text-[12px] leading-relaxed text-slate-700">{subHeading}</p>
          </div>

          {done ? (
            <div className="glass-success rounded-3xl p-4 text-center">
              <div className="text-lg font-bold text-emerald-900">
                {alreadySubmitted ? 'Siz artıq rəy bildirmisiniz' : 'Təşəkkür edirik'}
              </div>
              <p className="mt-2 text-sm text-emerald-900/80">
                {alreadySubmitted
                  ? 'Bu çek üçün endirim kuponunuz artıq yaradılıb və aşağıda göstərilir.'
                  : String(feedbackSettings?.thank_you_text_az || 'Rəyiniz komanda tərəfindən nəzərdən keçiriləcək.')}
              </p>
              {coupon?.code ? (
                <div className="mt-4 rounded-2xl border border-emerald-300/60 bg-white/55 p-3 text-left">
                  <div className="text-xs font-semibold text-emerald-800/80">Növbəti vizit üçün kupon</div>
                  <div className="mt-1 text-2xl font-black tracking-wider text-emerald-900">{coupon.code}</div>
                  <div className="mt-1 text-xs text-emerald-900/80">
                    POS-da kodu göstər, avtomatik {coupon.percent}% endirim tətbiq olunacaq.
                  </div>
                  {couponQrDataUrl ? (
                    <div className="mt-3 flex flex-col items-center rounded-xl border border-emerald-300/50 bg-white/80 p-2">
                      <img src={couponQrDataUrl} alt="Feedback coupon QR" className="h-28 w-28 rounded bg-white p-1" />
                      <div className="mt-2 text-[11px] text-emerald-900/80">Kassada QR-i skan edin (IWPOS:FB)</div>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={saveCouponCardAsPng}
                    disabled={savingPng}
                    className="mt-3 w-full rounded-full border border-emerald-300/80 bg-emerald-500/20 px-3 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-500/30 disabled:opacity-60"
                  >
                    {savingPng ? 'Şəkil hazırlanır...' : 'Save to Photos'}
                  </button>
                </div>
              ) : null}
              {viewReceiptUrl ? (
                <a
                  href={viewReceiptUrl}
                  className="mt-4 mr-2 inline-flex items-center gap-1 rounded-full border border-slate-300/70 bg-white/60 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-white/80"
                >
                  <Eye size={15} />
                  Çeki gör
                </a>
              ) : null}
              {googleReviewUrl ? (
                <a
                  href={googleReviewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex items-center rounded-full bg-gradient-to-r from-orange-400 via-pink-500 to-purple-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(168,85,247,0.32)]"
                >
                  Google Maps-də rəy yaz
                </a>
              ) : null}
            </div>
          ) : (
            <>
              <div className="mb-3">
                <h3 className="mb-2 text-sm font-semibold text-slate-800">Qiymətləndirmə</h3>
                <div className="star-strip relative flex items-center gap-1 rounded-2xl bg-white/35 px-2 py-2">
                  <div className="star-shimmer" />
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setScore(value)}
                      className={`star-btn rounded-xl p-2 transition ${score >= value ? 'is-active' : ''}`}
                      aria-label={`rate-${value}`}
                    >
                      <Star
                        size={28}
                        fill={score >= value ? 'url(#feedbackStarGradient)' : 'transparent'}
                        color={score >= value ? '#7C3AED' : '#64748b'}
                        strokeWidth={2}
                      />
                    </button>
                  ))}
                  <svg width="0" height="0">
                    <defs>
                      <linearGradient id="feedbackStarGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#F97316" />
                        <stop offset="45%" stopColor="#EC4899" />
                        <stop offset="100%" stopColor="#6366F1" />
                      </linearGradient>
                    </defs>
                  </svg>
                </div>
              </div>

              <div className="mb-3 rounded-2xl border border-white/40 bg-white/30 p-3 backdrop-blur-xl">
                <div className="mb-2 text-sm font-semibold text-slate-800">Tag seçimi</div>
                <div className="flex flex-wrap gap-2">
                  {availablePresetReasons.map((label) => {
                    const active = presetReasons.includes(label);
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => togglePresetReason(label)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                          active
                            ? 'border-white/70 bg-white/65 text-slate-900 shadow-[0_8px_20px_rgba(99,102,241,0.22)]'
                            : 'border-white/45 bg-white/35 text-slate-700 hover:bg-white/50'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-800">
                    Şərh {requireComment ? '(mütləqdir)' : '(opsional)'}
                  </label>
                  <textarea
                    className="glass-input min-h-[120px] w-full"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Nəyi yaxşılaşdıraq?"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-800">Əlaqə (opsional)</label>
                  <input
                    className="glass-input w-full"
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    placeholder="Telefon və ya email"
                  />
                </div>
                {error ? <div className="text-sm font-medium text-rose-700">{error}</div> : null}
              </div>

              <button
                type="button"
                onClick={onSubmit}
                disabled={!canSubmit}
                className={`cta-button relative mt-5 flex w-full items-center justify-center gap-2 rounded-full px-5 py-3.5 text-sm font-bold text-white transition ${
                  ctaPressed ? 'scale-[0.97]' : 'scale-100'
                } ${canSubmit ? '' : 'cursor-not-allowed opacity-55'}`}
              >
                {ctaRipple ? <span className="cta-ripple" /> : null}
                <SendHorizontal size={16} />
                {sending ? 'Göndərilir...' : 'Rəyi göndər'}
              </button>

              {viewReceiptUrl ? (
                <a
                  href={viewReceiptUrl}
                  className="mt-3 flex items-center justify-center gap-1 text-sm font-medium text-slate-700 underline decoration-dotted underline-offset-4 hover:text-slate-900"
                >
                  <Eye size={15} />
                  Çeki gör
                </a>
              ) : null}
            </>
          )}
        </div>

        <div className="glass-dock mt-4 flex items-center justify-around rounded-[22px] px-4 py-3">
          <button className="dock-btn"><ChevronLeft size={18} /></button>
          <button className="dock-btn"><ChevronRight size={18} /></button>
          <button className="dock-btn"><Share2 size={18} /></button>
          <button className="dock-btn"><Bookmark size={18} /></button>
        </div>
      </div>

      <style>{`
        .glass-safari {
          backdrop-filter: blur(22px);
          background: linear-gradient(135deg, rgba(255,255,255,0.28), rgba(255,255,255,0.12));
          border: 1px solid rgba(255,255,255,0.35);
          box-shadow: 0 10px 32px rgba(15, 23, 42, 0.16), inset 0 1px 0 rgba(255,255,255,0.45);
        }
        .glass-card {
          backdrop-filter: blur(26px);
          background: linear-gradient(145deg, rgba(255,255,255,0.32), rgba(255,255,255,0.18));
          border: 1px solid rgba(255,255,255,0.45);
          box-shadow: 0 22px 45px rgba(15, 23, 42, 0.2), inset 0 1px 0 rgba(255,255,255,0.55);
          animation: cardIn 520ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .glass-inner-highlight {
          pointer-events: none;
          position: absolute;
          inset: 0;
          background: linear-gradient(120deg, rgba(255,255,255,0.42) 0%, rgba(255,255,255,0) 35%);
          opacity: 0.45;
        }
        .glass-bubble {
          backdrop-filter: blur(18px);
          background: rgba(255,255,255,0.35);
          border: 1px solid rgba(255,255,255,0.5);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.65), 0 10px 25px rgba(15,23,42,0.14);
        }
        .glass-pill {
          backdrop-filter: blur(16px);
          background: rgba(255,255,255,0.36);
          border: 1px solid rgba(255,255,255,0.4);
        }
        .glass-input {
          border-radius: 22px;
          border: 1px solid rgba(255,255,255,0.55);
          background: rgba(255,255,255,0.45);
          color: #0f172a;
          padding: 12px 14px;
          backdrop-filter: blur(14px);
          outline: none;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.75);
        }
        .glass-input::placeholder {
          color: #64748b;
        }
        .glass-input:focus {
          border-color: rgba(129,140,248,0.8);
          box-shadow: 0 0 0 3px rgba(129,140,248,0.2), inset 0 1px 0 rgba(255,255,255,0.85);
        }
        .star-strip {
          overflow: hidden;
        }
        .star-shimmer {
          position: absolute;
          inset: 0;
          background: linear-gradient(115deg, rgba(255,255,255,0) 10%, rgba(255,255,255,0.45) 32%, rgba(255,255,255,0) 52%);
          transform: translateX(-120%);
          animation: starSweep 3s ease-in-out infinite;
          pointer-events: none;
        }
        .star-btn {
          position: relative;
          z-index: 2;
        }
        .star-btn.is-active {
          filter: brightness(1.06);
          transform: scale(1.05);
          animation: starPulse 460ms ease;
        }
        .cta-button {
          background: linear-gradient(120deg, #fb923c 0%, #ec4899 46%, #7c3aed 100%);
          box-shadow: 0 16px 36px rgba(139, 92, 246, 0.35), 0 6px 18px rgba(236, 72, 153, 0.25);
          animation: ctaGlow 2.4s ease-in-out infinite;
          overflow: hidden;
        }
        .cta-ripple {
          position: absolute;
          width: 22px;
          height: 22px;
          border-radius: 999px;
          background: rgba(255,255,255,0.8);
          opacity: 0.45;
          animation: ctaRipple 520ms ease-out forwards;
        }
        .glass-success {
          backdrop-filter: blur(20px);
          background: linear-gradient(145deg, rgba(255,255,255,0.58), rgba(226,255,236,0.48));
          border: 1px solid rgba(167,243,208,0.75);
          box-shadow: 0 18px 36px rgba(34,197,94,0.17);
        }
        .glass-dock {
          backdrop-filter: blur(20px);
          background: rgba(255,255,255,0.28);
          border: 1px solid rgba(255,255,255,0.42);
          box-shadow: 0 12px 28px rgba(15, 23, 42, 0.18), inset 0 1px 0 rgba(255,255,255,0.6);
        }
        .dock-btn {
          color: #334155;
          border-radius: 999px;
          padding: 8px;
          background: rgba(255,255,255,0.35);
          border: 1px solid rgba(255,255,255,0.4);
        }
        .blob-wave {
          position: absolute;
          filter: blur(50px);
          opacity: 0.4;
          border-radius: 999px;
          pointer-events: none;
        }
        .blob-wave-a {
          width: 260px;
          height: 260px;
          top: -60px;
          right: -80px;
          background: rgba(255,255,255,0.65);
          animation: blobFloatA 8s ease-in-out infinite;
        }
        .blob-wave-b {
          width: 300px;
          height: 220px;
          left: -90px;
          top: 38%;
          background: rgba(125,211,252,0.55);
          animation: blobFloatB 10s ease-in-out infinite;
        }
        .blob-wave-c {
          width: 280px;
          height: 180px;
          right: -70px;
          bottom: 12%;
          background: rgba(251,146,60,0.4);
          animation: blobFloatC 12s ease-in-out infinite;
        }
        @keyframes cardIn {
          from { opacity: 0; transform: translateY(18px) scale(0.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes starPulse {
          0% { transform: scale(0.92); }
          50% { transform: scale(1.12); }
          100% { transform: scale(1.05); }
        }
        @keyframes starSweep {
          0% { transform: translateX(-120%); }
          100% { transform: translateX(120%); }
        }
        @keyframes ctaGlow {
          0%, 100% { box-shadow: 0 16px 36px rgba(139,92,246,0.35), 0 6px 18px rgba(236,72,153,0.25); }
          50% { box-shadow: 0 18px 40px rgba(249,115,22,0.32), 0 8px 22px rgba(236,72,153,0.3); }
        }
        @keyframes ctaRipple {
          from { transform: scale(0.6); opacity: 0.55; }
          to { transform: scale(16); opacity: 0; }
        }
        @keyframes blobFloatA {
          0%, 100% { transform: translate3d(0, 0, 0); }
          50% { transform: translate3d(-18px, 14px, 0); }
        }
        @keyframes blobFloatB {
          0%, 100% { transform: translate3d(0, 0, 0); }
          50% { transform: translate3d(20px, -10px, 0); }
        }
        @keyframes blobFloatC {
          0%, 100% { transform: translate3d(0, 0, 0); }
          50% { transform: translate3d(-16px, -14px, 0); }
        }
      `}</style>
    </div>
  );
}

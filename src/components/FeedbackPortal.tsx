import React from 'react';
import { Star } from 'lucide-react';
import { get_business_profile, get_public_branding_live, get_settings } from '../api/settings';
import { submit_feedback_live } from '../api/feedback';

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
  const [error, setError] = React.useState('');
  const [coupon, setCoupon] = React.useState<{ code: string; percent: number } | null>(null);

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

  const feedbackSettings = settings?.feedback_settings || {};
  const primaryColor = String(settings?.customer_app_settings?.primary_color || '#facc15');
  const accentColor = String(settings?.customer_app_settings?.accent_color || '#22d3ee');
  const backgroundColor = String(settings?.customer_app_settings?.background_color || '#0b1220');
  const textColor = '#e5e7eb';
  const heading = 'Rəy və məmnuniyyət sorğusu';
  const subHeading = 'Xidmət keyfiyyətini yaxşılaşdırmaq üçün 30 saniyə ayırın.';
  const lowScoreThreshold = 3;
  const requireComment = score > 0 && score <= lowScoreThreshold;
  const canSubmit = score >= 1 && (!requireComment || comment.trim().length >= 3) && !sending;
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
      setDone(true);
    } catch (e: any) {
      setError(String(e?.message || 'Feedback göndərmək alınmadı'));
    } finally {
      setSending(false);
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
            <div className="text-lg font-bold text-emerald-200">Təşəkkür edirik</div>
            <p className="mt-2 text-sm text-emerald-100/90">
              {String(feedbackSettings?.thank_you_text_az || 'Rəyiniz komanda tərəfindən nəzərdən keçiriləcək.')}
            </p>
            {coupon?.code ? (
              <div className="mt-4 rounded-xl border border-emerald-300/40 bg-emerald-400/10 p-3 text-left">
                <div className="text-xs text-emerald-100/90">Növbəti vizit üçün kupon</div>
                <div className="mt-1 text-xl font-black tracking-wider text-emerald-200">{coupon.code}</div>
                <div className="mt-1 text-xs text-emerald-100/90">POS-da kodu göstər, avtomatik {coupon.percent}% endirim tətbiq olunacaq.</div>
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

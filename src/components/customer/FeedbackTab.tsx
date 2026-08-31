import React, { useState } from 'react';
import { Star, MessageSquare, SendHorizontal, Bookmark, CheckCircle2 } from 'lucide-react';
import { ImpactStyle } from '@capacitor/haptics';
import QRCode from 'qrcode';
import { tx } from '../../i18n';
import { playShimmerSound, Haptic, nativeHapticImpact } from '../../lib/customer_utils';
import { submit_feedback_live } from '../../api/feedback';
import { get_settings } from '../../api/settings';

type Props = {
  safeLang: string;
  customer: { card_id: string };
  sessionCreds: { cardId: string; token: string };
  primaryColor: string;
  accentColor: string;
  isLight?: boolean;
};

export default function FeedbackTab({
  safeLang, customer, sessionCreds, primaryColor, accentColor, isLight = false,
}: Props) {
  const [score, setScore] = useState<number>(0);
  const [hoverScore, setHoverScore] = useState<number>(0);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [comment, setComment] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [couponCode, setCouponCode] = useState<string | null>(null);
  const [couponPercent, setCouponPercent] = useState<number | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const tenantId = (sessionCreds as any)?.tenantId || 'tenant_default';
  const settings = get_settings(tenantId);
  const preset = Array.isArray(settings?.feedback_settings?.preset_tags)
    ? settings!.feedback_settings!.preset_tags
    : [];

  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(prev => prev.filter(t => t !== tag));
    } else {
      setSelectedTags(prev => [...prev, tag]);
    }
  };

  const resetForm = () => {
    setScore(0);
    setHoverScore(0);
    setSelectedTags([]);
    setComment('');
    setSubmitted(false);
    setCouponCode(null);
    setCouponPercent(null);
    setQrUrl(null);
    setErrorMsg(null);
  };

  const submit = async () => {
    if (score === 0) {
      setErrorMsg(tx(safeLang, 'Lütfən reytinq seçin', 'Пожалуйста, выберите рейтинг', 'Please select a rating'));
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await nativeHapticImpact(ImpactStyle.Medium);
      const payload = {
        tenant_id: tenantId,
        score,
        comment: [...selectedTags, comment].filter(Boolean).join(' | '),
        contact: customer.card_id,
        source: 'customer_app',
      };
      const res = await submit_feedback_live(payload);
      if (res && res.success) {
        setSubmitted(true);
        playShimmerSound();
        await Haptic.success();
        if (res.coupon_code) {
          setCouponCode(res.coupon_code);
          setCouponPercent(res.coupon_percent || 0);
          try {
            const url = await QRCode.toDataURL(`IWPOS:FB:${res.coupon_code.toUpperCase()}`, {
              width: 220, margin: 1, color: { dark: '#0f172a', light: '#ffffff' },
            });
            setQrUrl(url);
          } catch (err) {
            console.error('Failed to generate feedback QR', err);
          }
        }
      } else {
        setErrorMsg(tx(safeLang, 'Xəta baş verdi, bir daha sınayın', 'Не удалось отправить', 'Submission failed. Please try again.'));
      }
    } catch (err: any) {
      setErrorMsg(err.message || tx(safeLang, 'Xəta baş verdi', 'Ошибка', 'An error occurred'));
    } finally {
      setSubmitting(false);
    }
  };

  const textPrimary = isLight ? 'text-slate-900' : 'text-white';
  const textSecond  = isLight ? 'text-slate-500' : 'text-white/60';
  const textMuted   = isLight ? 'text-slate-400' : 'text-white/40';
  const bgCard      = isLight ? 'cust-glass-light' : 'cust-glass premium-shadow';
  const divider     = isLight ? 'border-black/5' : 'border-white/8';
  const chipActive  = isLight ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-900 border-white';
  const chipIdle    = isLight ? 'bg-white/60 text-slate-700 border-black/10' : 'bg-white/6 text-white/80 border-white/10';
  const taBg        = isLight ? 'bg-white/70 text-slate-900 placeholder:text-slate-400 border-black/10' : 'bg-white/5 text-white placeholder:text-white/30 border-white/10';

  return (
    <div className="space-y-4">
      <section className={`rounded-[28px] p-5 border ${bgCard}`}>
        <div className="flex items-center justify-between gap-3 mb-5">
          <p className={`text-[15px] font-bold flex items-center gap-2 ${textPrimary}`}>
            <MessageSquare size={16} className="text-[#F48C24]" />
            {tx(safeLang, 'Rəy bildirin', 'Оставьте отзыв', 'Share feedback')}
          </p>
          {submitted && (
            <button
              type="button"
              onClick={resetForm}
              className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border ${divider} ${textSecond}`}
            >
              {tx(safeLang, 'Yeni rəy', 'Новый отзыв', 'New')}
            </button>
          )}
        </div>

        {!submitted ? (
          <div className="space-y-5">
            {/* Star rating */}
            <div className="flex flex-col items-center gap-3 py-2">
              <p className={`text-[12px] font-semibold ${textSecond}`}>
                {tx(safeLang, 'Ümumi təcrübəniz necə idi?', 'Как вам общий опыт?', 'How was your overall experience?')}
              </p>
              <div className="flex items-center gap-2">
                {[1, 2, 3, 4, 5].map(n => {
                  const active = (hoverScore || score) >= n;
                  return (
                    <button
                      key={n}
                      type="button"
                      onMouseEnter={() => setHoverScore(n)}
                      onMouseLeave={() => setHoverScore(0)}
                      onClick={async () => {
                        setScore(n);
                        await nativeHapticImpact(ImpactStyle.Light);
                      }}
                      className="transition-all active:scale-90"
                      style={{ transition: 'transform 160ms ease' }}
                    >
                      <Star
                        size={34}
                        fill={active ? primaryColor : 'transparent'}
                        stroke={active ? primaryColor : (isLight ? '#94a3b8' : 'rgba(255,255,255,0.35)')}
                        strokeWidth={1.5}
                        style={{ filter: active ? `drop-shadow(0 4px 12px ${primaryColor}80)` : 'none' }}
                      />
                    </button>
                  );
                })}
              </div>
              {score > 0 && (
                <p className="text-[11px] font-bold" style={{ color: primaryColor }}>
                  {score <= 1
                    ? tx(safeLang, 'Çox pis', 'Очень плохо', 'Very bad')
                    : score === 2
                    ? tx(safeLang, 'Pis', 'Плохо', 'Bad')
                    : score === 3
                    ? tx(safeLang, 'Normal', 'Нормально', 'Okay')
                    : score === 4
                    ? tx(safeLang, 'Yaxşı', 'Хорошо', 'Good')
                    : tx(safeLang, 'Əla!', 'Отлично!', 'Excellent!')}
                </p>
              )}
            </div>

            {/* Preset tags */}
            {preset.length > 0 && (
              <div>
                <p className={`text-[11px] font-bold uppercase tracking-widest mb-2 ${textMuted}`}>
                  {tx(safeLang, 'Tez qeyd edin', 'Быстрые отметки', 'Quick tags')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {preset.map((tag: string) => {
                    const active = selectedTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className={`rounded-full px-3 py-1.5 text-[12px] font-semibold border transition-all active:scale-95 ${active ? chipActive : chipIdle}`}
                        style={active ? { background: `linear-gradient(135deg, ${primaryColor}, ${accentColor})`, borderColor: 'transparent', color: '#0f172a' } : {}}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Comment */}
            <div>
              <p className={`text-[11px] font-bold uppercase tracking-widest mb-2 ${textMuted}`}>
                {tx(safeLang, 'Əlavə qeyd (istəyə bağlı)', 'Комментарий (опционально)', 'Additional comments (optional)')}
              </p>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder={tx(safeLang, 'Fikirlərinizi bölüşün...', 'Поделитесь мыслями...', 'Share your thoughts...')}
                className={`w-full rounded-2xl p-3 text-[13px] border outline-none focus:ring-2 transition ${taBg}`}
                style={{ boxShadow: isLight ? 'inset 0 1px 2px rgba(0,0,0,0.04)' : 'inset 0 1px 2px rgba(0,0,0,0.3)' }}
              />
              <p className={`mt-1 text-[10px] text-right ${textMuted}`}>{comment.length}/500</p>
            </div>

            {errorMsg && (
              <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2 text-[12px] font-semibold text-red-400">
                {errorMsg}
              </div>
            )}

            <button
              type="button"
              disabled={submitting || score === 0}
              onClick={submit}
              className="relative w-full overflow-hidden rounded-2xl py-3.5 text-[13px] font-black text-slate-900 transition-all active:scale-[0.98] shimmer-btn disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              style={{
                background: `linear-gradient(135deg, ${primaryColor}, ${accentColor})`,
                boxShadow: `0 10px 28px ${primaryColor}40`,
              }}
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full border-2 border-slate-900/40 border-t-slate-900 animate-spin" />
                  {tx(safeLang, 'Göndərilir...', 'Отправка...', 'Sending...')}
                </span>
              ) : (
                <>
                  <SendHorizontal size={15} />
                  {tx(safeLang, 'Rəyi göndər', 'Отправить отзыв', 'Send feedback')}
                </>
              )}
            </button>

            <p className={`text-[10px] text-center ${textMuted}`}>
              <Bookmark size={10} className="inline mr-1" />
              {tx(safeLang, 'Rəyiniz üçün xüsusi kupon qazana bilərsiniz!', 'Получите купон за отзыв!', 'Get a coupon for your feedback!')}
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Success state */}
            <div className="flex flex-col items-center gap-3 py-3 text-center">
              <div
                className="h-16 w-16 rounded-full flex items-center justify-center"
                style={{
                  background: `linear-gradient(135deg, ${primaryColor}30, ${accentColor}30)`,
                  boxShadow: `0 0 0 8px ${primaryColor}10`,
                }}
              >
                <CheckCircle2 size={34} style={{ color: primaryColor }} />
              </div>
              <div>
                <p className={`text-[15px] font-black ${textPrimary}`}>
                  {tx(safeLang, 'Təşəkkür edirik!', 'Спасибо!', 'Thank you!')}
                </p>
                <p className={`mt-1 text-[12px] ${textSecond}`}>
                  {tx(safeLang, 'Rəyiniz komanda tərəfindən nəzərdən keçiriləcək.', 'Ваш отзыв будет рассмотрен командой.', 'Your feedback will be reviewed by our team.')}
                </p>
              </div>
            </div>

            {couponCode && (
              <div
                className="relative overflow-hidden rounded-2xl p-5 shimmer-card"
                style={{
                  background: 'linear-gradient(135deg, rgba(244,140,36,0.14), rgba(250,204,21,0.08))',
                  border: `1px solid ${primaryColor}50`,
                  boxShadow: `0 10px 28px ${primaryColor}25`,
                }}
              >
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#F48C24]">
                  {tx(safeLang, 'Xüsusi kupon', 'Специальный купон', 'Special coupon')}
                </p>
                <p className={`mt-2 text-2xl font-black font-mono ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  {couponCode}
                </p>
                {couponPercent ? (
                  <p className={`mt-1 text-[12px] font-bold ${textSecond}`}>
                    {tx(safeLang, `${couponPercent}% endirim`, `Скидка ${couponPercent}%`, `${couponPercent}% off`)}
                  </p>
                ) : null}

                {qrUrl && (
                  <div className="mt-4 rounded-2xl bg-white p-4 flex justify-center shadow-inner">
                    <img src={qrUrl} alt="feedback qr" className="h-40 w-40 object-contain" />
                  </div>
                )}
                <p className="mt-3 text-[9px] font-black uppercase tracking-[0.2em] text-center" style={{ color: primaryColor }}>
                  {tx(safeLang, 'Kassada göstərin', 'Покажите на кассе', 'Show at POS')}
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={resetForm}
              className={`w-full rounded-2xl py-3 text-[12px] font-bold border transition active:scale-[0.98] ${divider} ${textSecond}`}
            >
              {tx(safeLang, 'Yeni rəy yaz', 'Новый отзыв', 'Write another feedback')}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

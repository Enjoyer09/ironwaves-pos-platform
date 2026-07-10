import React from 'react';
import { Gift, Sparkles, Clock } from 'lucide-react';
import { ImpactStyle } from '@capacitor/haptics';
import QRCode from 'qrcode';
import { tx } from '../../i18n';
import { playShimmerSound, Haptic, nativeHapticImpact } from '../../lib/customer_utils';

type Props = {
  safeLang: string;
  campaigns: any[];
  pendingClaims: any[];
  customer: { card_id: string };
  activatedCampaigns: Record<string, number>;
  setActivatedCampaigns: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  campaignQrs: Record<string, string>;
  setCampaignQrs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  primaryColor: string;
  isLight?: boolean;
  accentColor: string;
};

export default function OffersTab({
  safeLang, campaigns, pendingClaims, customer, activatedCampaigns,
  setActivatedCampaigns, campaignQrs, setCampaignQrs, primaryColor, accentColor, isLight = false
}: Props) {

  const activateCampaign = async (campaignId: string) => {
    await nativeHapticImpact(ImpactStyle.Medium);
    const expTime = Date.now() + 15 * 60 * 1000;
    setActivatedCampaigns(prev => ({ ...prev, [campaignId]: expTime }));
    playShimmerSound();
    try {
      const qrUrl = await QRCode.toDataURL(`IWPOS:CAMPAIGN:${campaignId}:${customer.card_id}`, {
        width: 180, margin: 1, color: { dark: '#0f172a', light: '#ffffff' }
      });
      setCampaignQrs(prev => ({ ...prev, [campaignId]: qrUrl }));
    } catch (err) {
      console.error('Failed to generate campaign QR', err);
    }
  };

  const textPrimary = isLight ? 'text-slate-900' : 'text-white';
  const textSecond  = isLight ? 'text-slate-500' : 'text-white/60';
  const textMuted   = isLight ? 'text-slate-400' : 'text-white/40';
  const bgCard      = isLight ? 'cust-glass-light' : 'cust-glass premium-shadow';
  const divider     = isLight ? 'border-black/5' : 'border-white/8';
  const emptyBorder = isLight ? 'border-black/8 bg-black/3' : 'border-white/10 bg-white/4';
  const circleBg    = isLight ? 'bg-slate-50' : 'bg-[#0D0B0A]';

  return (
    <div className="space-y-4">
      {/* Active Campaigns */}
      <section className={`rounded-[28px] p-5 border ${bgCard}`}>
        <div className="flex items-center justify-between gap-3 mb-5">
          <p className={`text-[15px] font-bold flex items-center gap-2 ${textPrimary}`}>
            <Gift size={16} className="text-[#F48C24]" />
            {tx(safeLang, 'Aktiv kampaniyalar', 'Активные кампании', 'Active offers')}
          </p>
          <span className="rounded-full px-2.5 py-0.5 text-[10px] font-black text-white shimmer-btn"
            style={{ background: `linear-gradient(135deg, ${primaryColor}, ${accentColor})`, boxShadow: `0 4px 12px ${primaryColor}40` }}>
            {campaigns.length}
          </span>
        </div>

        <div className="space-y-4">
          {campaigns.length === 0 ? (
            <div className={`flex flex-col items-center gap-3 py-8 text-center border border-dashed rounded-2xl ${emptyBorder} ${textMuted}`}>
              <Gift size={28} className={textMuted} />
              <p className="text-[13px] font-semibold">{tx(safeLang, 'Hazırda aktiv kampaniya yoxdur', 'Сейчас нет активных кампаний', 'No active campaigns right now')}</p>
            </div>
          ) : campaigns.map((row: any, idx: number) => {
            const expTime        = activatedCampaigns[row.id];
            const isActive       = expTime && expTime > Date.now();
            const timeLeftMs     = isActive ? expTime - Date.now() : 0;
            const secondsLeft    = Math.max(0, Math.floor(timeLeftMs / 1000));
            const minutes        = Math.floor(secondsLeft / 60);
            const seconds        = secondsLeft % 60;
            const progressPct    = isActive ? Math.max(0, Math.min(100, (secondsLeft / 900) * 100)) : 0;

            return (
              <div key={row.id}
                className={`relative overflow-hidden rounded-[24px] border transition-all duration-300 stagger-fade-in stagger-${Math.min(idx + 1, 5)} ${
                  isActive
                    ? 'animate-green-glow neon-border-green'
                    : isLight ? 'bg-white/60 border-black/8' : 'bg-white/3 border-white/8'
                }`}
                style={isActive ? {
                  background: isLight ? 'rgba(240,253,244,0.8)' : 'rgba(34,197,94,0.04)',
                } : undefined}>

                {/* Glossy top */}
                <div className="absolute inset-x-0 top-0 h-12 pointer-events-none rounded-t-[24px]"
                  style={{ background: isLight ? 'linear-gradient(180deg, rgba(255,255,255,0.5), transparent)' : 'linear-gradient(180deg, rgba(255,255,255,0.04), transparent)' }} />

                {/* Perforations */}
                <div className={`absolute -left-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border-r ${circleBg}`}
                  style={{ borderColor: isActive ? 'rgba(34,197,94,0.30)' : isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)' }} />
                <div className={`absolute -right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border-l ${circleBg}`}
                  style={{ borderColor: isActive ? 'rgba(34,197,94,0.30)' : isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)' }} />

                <div className="p-5 relative z-10">
                  <div className="flex justify-between items-start gap-4">
                    <div>
                      <h4 className={`text-[15px] font-black leading-tight ${textPrimary}`}>{row.name}</h4>
                      <p className="mt-1.5 text-[15px] font-extrabold gradient-text-animated">
                        {row.discount_percent}% {tx(safeLang, 'endirim', 'скидка', 'discount')}
                      </p>
                      <p className={`mt-2 text-[10px] font-bold flex items-center gap-1 ${textMuted}`}>
                        <Clock size={10} />
                        {row.start_time} - {row.end_time} · {row.categories || 'ALL'}
                      </p>
                    </div>
                    {/* Discount badge */}
                    <div className="flex-shrink-0 h-14 w-14 rounded-2xl flex flex-col items-center justify-center border"
                      style={{
                        background: isActive ? 'rgba(34,197,94,0.12)' : `rgba(244,140,36,0.10)`,
                        borderColor: isActive ? 'rgba(34,197,94,0.25)' : `rgba(244,140,36,0.20)`,
                      }}>
                      <span className={`text-lg font-black ${isActive ? 'text-emerald-500' : 'text-[#F48C24]'}`}>{row.discount_percent}%</span>
                      <span className={`text-[8px] font-bold uppercase tracking-wider ${isActive ? 'text-emerald-400' : 'text-[#F48C24]/70'}`}>off</span>
                    </div>
                  </div>

                  {isActive ? (
                    <div className={`mt-4 pt-4 border-t border-dashed space-y-4 ${divider}`}>
                      {/* Timer row */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-500">
                          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                          <span>{tx(safeLang, 'Kod aktivdir', 'Код активен', 'Code is active')}</span>
                        </div>
                        <span className="font-mono text-sm font-black text-emerald-500 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
                          {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
                        </span>
                      </div>
                      {/* Progress */}
                      <div className={`h-1.5 w-full rounded-full overflow-hidden ${isLight ? 'bg-black/8' : 'bg-white/8'}`}>
                        <div
                          className="h-full rounded-full transition-all duration-1000"
                          style={{
                            width: `${progressPct}%`,
                            background: 'linear-gradient(90deg, #10b981, #34d399)',
                            boxShadow: '0 0 8px rgba(52,211,153,0.50)',
                          }} />
                      </div>
                      {/* QR */}
                      <div className="rounded-2xl overflow-hidden shadow-xl"
                        style={{
                          background: 'rgba(255,255,255,0.95)',
                          backdropFilter: 'blur(12px)',
                          border: '1px solid rgba(0,0,0,0.05)',
                          padding: '16px',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                        }}>
                        {campaignQrs[row.id] ? (
                          <img src={campaignQrs[row.id]} alt="campaign qr" className="h-36 w-36 object-contain" />
                        ) : (
                          <div className="h-36 w-36 flex items-center justify-center text-slate-800 text-xs font-mono">{row.id}</div>
                        )}
                        <p className="mt-3 text-[10px] font-black text-slate-900 tracking-widest uppercase">
                          {tx(safeLang, 'KASSAYA TƏQDİM EDİN', 'ПРЕДЪЯВИТЕ НА КАССЕ', 'PRESENT TO CASHIER')}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className={`mt-4 pt-3 border-t flex justify-end ${divider}`}>
                      <button
                        type="button"
                        onClick={async () => { await Haptic.medium(); activateCampaign(row.id); }}
                        className="relative overflow-hidden rounded-xl px-5 py-2.5 text-[11px] font-black text-white transition-all active:scale-[0.97] shimmer-btn"
                        style={{
                          background: `linear-gradient(135deg, ${primaryColor} 0%, ${accentColor} 100%)`,
                          boxShadow: `0 6px 18px ${primaryColor}45`,
                        }}>
                        ✨ {tx(safeLang, 'Aktivləşdir', 'Активировать', 'Activate')}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Claim Codes */}
      <section className={`rounded-[28px] p-5 border ${bgCard}`}>
        <p className={`text-[15px] font-bold flex items-center gap-2 mb-4 ${textPrimary}`}>
          <Sparkles size={16} className="text-[#F48C24]" />
          {tx(safeLang, 'Claim kodları', 'Коды наград', 'Claim codes')}
        </p>
        <div className="space-y-3">
          {pendingClaims.length === 0 ? (
            <div className={`py-8 text-center text-[12px] border border-dashed rounded-2xl ${emptyBorder} ${textMuted}`}>
              {tx(safeLang, 'Aktiv claim kodu yoxdur', 'Активных кодов нет', 'No active claim codes')}
            </div>
          ) : pendingClaims.map((row: any) => (
            <div key={row.id}
              className="relative overflow-hidden rounded-2xl p-4 border shimmer-card"
              style={{
                background: 'linear-gradient(135deg, rgba(244,140,36,0.12), rgba(244,140,36,0.06))',
                border: '1px solid rgba(244,140,36,0.32)',
                boxShadow: '0 4px 16px rgba(244,140,36,0.10), inset 0 1px 0 rgba(255,255,255,0.06)',
              }}>
              <div className={`absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-r ${circleBg} border-[#F48C24]/20`} />
              <div className={`absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-l ${circleBg} border-[#F48C24]/20`} />
              <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#F48C24]/70">{tx(safeLang, 'Kassada göstərin', 'Покажите на кассе', 'Show at POS')}</p>
              <p className={`mt-1 text-2xl font-black font-mono ${isLight ? 'text-slate-800' : 'text-white'}`}>{row.claim_code}</p>
              <p className={`mt-1 text-[11px] ${textSecond}`}>{row.reward_name}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

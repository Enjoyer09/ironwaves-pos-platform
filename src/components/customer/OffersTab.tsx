import React from 'react';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import QRCode from 'qrcode';
import { Gift, Sparkles } from 'lucide-react';
import { tx } from '../../i18n';
import { playShimmerSound, nativeHapticImpact } from '../../lib/customer_utils';

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
  accentColor: string;
};

export default function OffersTab({
  safeLang, campaigns, pendingClaims, customer, activatedCampaigns,
  setActivatedCampaigns, campaignQrs, setCampaignQrs, primaryColor, accentColor
}: Props) {
  const activateCampaign = async (campaignId: string) => {
    await nativeHapticImpact(ImpactStyle.Medium);
    const expTime = Date.now() + 15 * 60 * 1000;
    setActivatedCampaigns(prev => ({ ...prev, [campaignId]: expTime }));
    playShimmerSound();
    try {
      const qrUrl = await QRCode.toDataURL(`IWPOS:CAMPAIGN:${campaignId}:${customer.card_id}`, {
        width: 180,
        margin: 1,
        color: { dark: '#0f172a', light: '#ffffff' }
      });
      setCampaignQrs(prev => ({ ...prev, [campaignId]: qrUrl }));
    } catch (err) {
      console.error('Failed to generate campaign QR', err);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-[28px] p-5 border border-white/10 shadow-2xl bg-white/5 backdrop-blur-xl text-white">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[15px] font-bold text-white flex items-center gap-2">
            <Gift size={16} className="text-[#F48C24]" />
            {tx(safeLang, 'Aktiv kampaniyalar', 'Активные кампании', 'Active offers')}
          </p>
          <span className="rounded-full px-2.5 py-0.5 text-[10px] font-black text-white" style={{ backgroundColor: primaryColor }}>{campaigns.length}</span>
        </div>

        <div className="mt-4 space-y-4">
          {campaigns.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center border border-dashed border-white/10 rounded-2xl bg-white/5">
              <Gift size={28} className="text-white/20" />
              <p className="text-[13px] text-white/40 font-semibold">{tx(safeLang, 'Hazırda aktiv kampaniya yoxdur', 'Сейчас нет активных кампаний', 'No active campaigns right now')}</p>
            </div>
          ) : campaigns.map((row: any) => {
            const expTime = activatedCampaigns[row.id];
            const isActive = expTime && expTime > Date.now();
            const timeLeftMs = isActive ? expTime - Date.now() : 0;
            const secondsLeft = Math.max(0, Math.floor(timeLeftMs / 1000));
            const minutes = Math.floor(secondsLeft / 60);
            const seconds = secondsLeft % 60;
            const progressPercent = isActive ? Math.max(0, Math.min(100, (secondsLeft / 900) * 100)) : 0;

            return (
              <div
                key={row.id}
                className="relative overflow-hidden rounded-[24px] border p-5 shadow-2xl transition-all duration-300"
                style={{
                  backgroundColor: isActive ? 'rgba(34, 197, 94, 0.05)' : 'rgba(255, 255, 255, 0.02)',
                  borderColor: isActive ? 'rgba(34, 197, 94, 0.3)' : 'rgba(255, 255, 255, 0.08)'
                }}
              >
                <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-[#0D0B0A] border-r border-white/10" style={{ borderColor: isActive ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.08)' }} />
                <div className="absolute -right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-[#0D0B0A] border-l border-white/10" style={{ borderColor: isActive ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.08)' }} />

                <div className="flex justify-between items-start gap-4">
                  <div>
                    <h4 className="text-[15px] font-black text-white leading-tight">{row.name}</h4>
                    <p className="mt-1.5 text-[13px] font-extrabold" style={{ color: primaryColor }}>
                      {row.discount_percent}% {tx(safeLang, 'endirim', 'скидка', 'discount')}
                    </p>
                    <p className="mt-2 text-[10px] font-bold text-white/40">
                      {row.start_time} - {row.end_time} • {row.categories || 'ALL'}
                    </p>
                  </div>
                </div>

                {isActive ? (
                  <div className="mt-5 pt-4 border-t border-dashed border-white/10 space-y-4">
                    <div className="flex items-center justify-between text-xs font-bold text-emerald-400">
                      <span>{tx(safeLang, 'Kod aktivdir', 'Код активен', 'Code is active')}</span>
                      <span className="font-mono bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                        {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-1000 rounded-full"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                    <div className="flex flex-col items-center justify-center p-4 bg-white border border-white/10 rounded-2xl shadow-inner">
                      {campaignQrs[row.id] ? (
                        <img src={campaignQrs[row.id]} alt="campaign qr" className="h-36 w-36 object-contain" />
                      ) : (
                        <div className="h-36 w-36 flex items-center justify-center text-slate-800 text-xs font-mono">
                          {row.id}
                        </div>
                      )}
                      <p className="mt-2 text-[10px] font-mono font-bold text-slate-900 tracking-widest uppercase">
                        {tx(safeLang, 'KASSAYA TƏQDİM EDİN', 'ПРЕДЪЯВИТЕ НА КАССЕ', 'PRESENT TO CASHIER')}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 pt-3 border-t border-white/10 flex justify-end">
                    <button
                      type="button"
                      onClick={() => activateCampaign(row.id)}
                      className="relative overflow-hidden rounded-xl px-4 py-2 text-[11px] font-black text-white transition-all active:scale-[0.97]"
                      style={{
                        background: `linear-gradient(135deg, ${primaryColor} 0%, ${accentColor} 100%)`,
                      }}
                    >
                      {tx(safeLang, 'Aktivləşdir', 'Активировать', 'Activate')}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-[28px] p-5 border border-white/10 shadow-2xl bg-white/5 backdrop-blur-xl text-white">
        <p className="text-[15px] font-bold text-white flex items-center gap-2">
          <Sparkles size={16} className="text-[#F48C24]" />
          {tx(safeLang, 'Claim kodları', 'Коды наград', 'Claim codes')}
        </p>
        <div className="mt-4 space-y-3">
          {pendingClaims.length === 0 ? (
            <div className="py-8 text-center text-[12px] text-white/30 border border-dashed border-white/10 rounded-2xl bg-white/5">
              {tx(safeLang, 'Aktiv claim kodu yoxdur', 'Активных кодов нет', 'No active claim codes')}
            </div>
          ) : pendingClaims.map((row: any) => (
            <div key={row.id} className="relative overflow-hidden rounded-2xl p-4 border border-[#F48C24]/30 bg-[#F48C24]/10 shadow-2xl">
              <div className="absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-[#0D0B0A] border-r border-[#F48C24]/20" />
              <div className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-[#0D0B0A] border-l border-[#F48C24]/20" />
              <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/60">{tx(safeLang, 'Kassada göstərin', 'Покажите на кассе', 'Show at POS')}</p>
              <p className="mt-1 text-2xl font-black text-white font-mono">{row.claim_code}</p>
              <p className="mt-1 text-[11px] text-white/40">{row.reward_name}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

import React from 'react';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Mic, Volume2, VolumeX } from 'lucide-react';
import { tx } from '../../i18n';
import { BARISTA_QUICK_PROMPTS, nativeHapticImpact } from '../../lib/customer_utils';

type Props = {
  safeLang: string;
  baristaMessages: Array<{ role: 'assistant' | 'user'; text: string }>;
  baristaInput: string;
  setBaristaInput: (val: string) => void;
  voiceEnabled: boolean;
  setVoiceEnabled: (val: boolean) => void;
  isListening: boolean;
  toggleListening: () => void;
  sendBaristaMessage: () => void;
  primaryColor: string;
  isLight?: boolean;
  accentColor: string;
};

export default function BaristaTab({
  safeLang, baristaMessages, baristaInput, setBaristaInput,
  voiceEnabled, setVoiceEnabled, isListening, toggleListening,
  sendBaristaMessage, primaryColor, accentColor
}: Props) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-white/6 p-5 backdrop-blur-xl space-y-4">
      <style>{`
        @keyframes dotBounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        .animate-dotBounce {
          animation: dotBounce 1.2s infinite ease-in-out;
        }
      `}</style>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">🤖</span>
          <div>
            <div className="text-md font-black text-white tracking-tight">AI Barista</div>
            <div className="text-[11px] text-white/50 font-semibold">{tx(safeLang, 'Söhbət et, içki və reward tövsiyəsi al.', 'Поговори и получи совет по напиткам и наградам.', 'Chat and get drink and reward suggestions.')}</div>
          </div>
        </div>
        <button
          onClick={async () => {
            setVoiceEnabled(!voiceEnabled);
            await nativeHapticImpact(ImpactStyle.Light);
          }}
          className={`h-9 w-9 rounded-xl flex items-center justify-center border transition-all ${
            voiceEnabled 
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
              : 'bg-white/5 border-white/10 text-white/40'
          }`}
        >
          {voiceEnabled ? <Volume2 size={16} className="animate-pulse" /> : <VolumeX size={16} />}
        </button>
      </div>

      <div className="max-h-72 space-y-3.5 overflow-y-auto rounded-[24px] bg-slate-950/35 p-4 border border-white/5">
        {baristaMessages.map((msg, idx) => (
          <div key={`${msg.role}_${idx}`} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.text === '...' ? (
              <div className="max-w-[80%] rounded-2xl rounded-tl-none px-4 py-3 bg-white/10 border border-white/10 text-slate-100 shadow-md backdrop-blur-md">
                <div className="flex items-center gap-1.5 py-1 px-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-300 animate-dotBounce" style={{ animationDelay: '0ms' as any }} />
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-300 animate-dotBounce" style={{ animationDelay: '150ms' as any }} />
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-300 animate-dotBounce" style={{ animationDelay: '300ms' as any }} />
                </div>
              </div>
            ) : (
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 text-[13px] font-medium leading-relaxed shadow-md transition-all active:scale-[0.98] ${
                  msg.role === 'user' 
                    ? 'rounded-tr-none text-slate-950' 
                    : 'rounded-tl-none bg-white/[0.08] border border-white/10 text-slate-100 backdrop-blur-md'
                }`}
                style={msg.role === 'user' ? { background: `linear-gradient(135deg, ${primaryColor} 0%, ${accentColor} 100%)` } : undefined}
              >
                {msg.text}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        {BARISTA_QUICK_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => setBaristaInput(prompt)}
            className="rounded-full border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition-all duration-200 hover:scale-[1.03] active:scale-95 shadow-sm"
          >
            {prompt}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1 flex items-center">
          <input
            value={baristaInput}
            onChange={(e) => setBaristaInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') sendBaristaMessage(); }}
            placeholder={tx(safeLang, 'Mənə nə tövsiyə edərsən?', 'Что ты посоветуешь мне?', 'What would you recommend for me?')}
            style={{
              borderRadius: '16px',
              backgroundColor: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              padding: '12px 48px 12px 16px',
              fontSize: '13px',
              color: 'white',
              outline: 'none',
              width: '100%'
            }}
          />
          <button
            type="button"
            onClick={toggleListening}
            className={`absolute right-3 p-1.5 rounded-lg transition-all ${
              isListening 
                ? 'bg-red-500 text-white animate-pulse' 
                : 'text-white/40 hover:text-white/70'
            }`}
          >
            <Mic size={16} />
          </button>
        </div>
        <button
          type="button"
          onClick={sendBaristaMessage}
          className="rounded-2xl px-5 py-3 font-black text-[12px] text-slate-950 active:scale-95 transition-transform"
          style={{
            background: `linear-gradient(135deg, ${accentColor} 0%, ${primaryColor} 100%)`,
            boxShadow: `0 4px 12px ${accentColor}33`
          }}
        >
          {tx(safeLang, 'Göndər', 'Отправить', 'Send')}
        </button>
      </div>
    </section>
  );
}

import React from 'react';
import { Mic, Volume2, VolumeX, Send } from 'lucide-react';
import { ImpactStyle } from '@capacitor/haptics';
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
  sendBaristaMessage, primaryColor, accentColor, isLight = false
}: Props) {
  const chatEndRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [baristaMessages]);

  const textPrimary = isLight ? 'text-slate-900' : 'text-white';
  const textSecond  = isLight ? 'text-slate-500' : 'text-white/50';
  const bgCard      = isLight ? 'cust-glass-light' : 'cust-glass premium-shadow';
  const chatAreaBg  = isLight ? 'bg-white/60 border-black/5' : 'bg-black/20 border-white/5 backdrop-blur-sm';
  const botBubble   = isLight
    ? 'bg-white border-black/8 text-slate-800 shadow-sm'
    : 'bg-white/8 border-white/10 text-slate-100 backdrop-blur-md';
  const promptBtn   = isLight
    ? 'bg-white/80 border-black/8 text-slate-700 hover:bg-white shadow-sm'
    : 'bg-white/6 border-white/10 text-slate-200 hover:bg-white/12';

  return (
    <section className={`rounded-[28px] border p-5 space-y-4 ${bgCard}`}>
      <style>{`
        @keyframes dotBounce {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(-6px); }
        }
        .animate-dotBounce { animation: dotBounce 1.2s infinite ease-in-out; }
        @keyframes micRing {
          0%, 100% { transform: scale(1); opacity: 0.6; }
          50%       { transform: scale(1.35); opacity: 0; }
        }
        .mic-ring::before {
          content: '';
          position: absolute;
          inset: -4px;
          border-radius: 50%;
          border: 2px solid #ef4444;
          animation: micRing 1.2s ease-in-out infinite;
        }
      `}</style>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`h-10 w-10 rounded-2xl flex items-center justify-center text-xl border float-slow ${isLight ? 'bg-white border-black/8 shadow-sm' : 'bg-white/8 border-white/10'}`}>
            🤖
          </div>
          <div>
            <div className={`text-[15px] font-black tracking-tight ${textPrimary}`}>AI Barista</div>
            <div className={`text-[10px] font-semibold ${textSecond}`}>
              {tx(safeLang, 'Söhbət et, tövsiyə al.', 'Поговори и получи совет.', 'Chat and get recommendations.')}
            </div>
          </div>
        </div>
        <button
          onClick={async () => { setVoiceEnabled(!voiceEnabled); await nativeHapticImpact(ImpactStyle.Light); }}
          className={`h-9 w-9 rounded-xl flex items-center justify-center border transition-all ${
            voiceEnabled
              ? 'bg-emerald-500/12 border-emerald-500/30 text-emerald-400 animate-green-glow'
              : isLight ? 'bg-black/5 border-black/8 text-slate-400' : 'bg-white/5 border-white/10 text-white/40'
          }`}>
          {voiceEnabled ? <Volume2 size={16} className="animate-pulse" /> : <VolumeX size={16} />}
        </button>
      </div>

      {/* Chat Area */}
      <div className={`max-h-72 space-y-3.5 overflow-y-auto rounded-[24px] p-4 border ${chatAreaBg}`}>
        {baristaMessages.map((msg, idx) => (
          <div key={`${msg.role}_${idx}`} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} stagger-fade-in`}>
            {msg.text === '...' ? (
              <div className={`max-w-[80%] rounded-2xl rounded-tl-none px-4 py-3 border shadow-md ${botBubble}`}>
                <div className="flex items-center gap-1.5 py-1 px-1">
                  {[0, 150, 300].map(delay => (
                    <span key={delay} className={`h-2.5 w-2.5 rounded-full animate-dotBounce ${isLight ? 'bg-slate-400' : 'bg-slate-300'}`} style={{ animationDelay: `${delay}ms` }} />
                  ))}
                </div>
              </div>
            ) : (
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 text-[13px] font-medium leading-relaxed shadow-md transition-all ${
                  msg.role === 'user'
                    ? 'rounded-tr-none text-white shimmer-card'
                    : `rounded-tl-none border ${botBubble}`
                }`}
                style={msg.role === 'user' ? {
                  background: `linear-gradient(135deg, ${primaryColor} 0%, ${accentColor} 100%)`,
                  boxShadow: `0 4px 12px ${primaryColor}40`,
                } : undefined}>
                {msg.text}
              </div>
            )}
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Quick Prompts */}
      <div className="flex flex-wrap gap-2 pt-1">
        {BARISTA_QUICK_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => setBaristaInput(prompt)}
            className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-all hover:scale-[1.03] active:scale-95 ${promptBtn}`}>
            {prompt}
          </button>
        ))}
      </div>

      {/* Input Row */}
      <div className="flex gap-2">
        <div className="relative flex-1 flex items-center">
          <input
            value={baristaInput}
            onChange={(e) => setBaristaInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') sendBaristaMessage(); }}
            placeholder={tx(safeLang, 'Mənə nə tövsiyə edərsən?', 'Что ты посоветуешь мне?', 'What would you recommend?')}
            className={`rounded-2xl border px-4 py-3 text-[13px] outline-none w-full transition ${
              isLight
                ? 'bg-white/80 border-black/8 text-slate-900 placeholder-slate-400 focus:ring-1 focus:ring-[#F48C24] shadow-sm'
                : 'bg-white/6 border-white/10 text-white placeholder-white/30 focus:ring-1 focus:ring-[#F48C24] backdrop-blur-sm'
            }`}
            style={{ paddingRight: '48px' }}
          />
          <button
            type="button"
            onClick={toggleListening}
            className={`absolute right-3 p-1.5 rounded-lg transition-all ${
              isListening
                ? 'bg-red-500 text-white mic-ring relative'
                : isLight ? 'text-slate-400 hover:text-slate-600' : 'text-white/40 hover:text-white/70'
            }`}>
            <Mic size={16} />
          </button>
        </div>
        <button
          type="button"
          onClick={sendBaristaMessage}
          className="rounded-2xl px-5 py-3 font-black text-[12px] text-white active:scale-95 transition-all flex items-center gap-1.5 shimmer-btn"
          style={{
            background: `linear-gradient(135deg, ${accentColor} 0%, ${primaryColor} 100%)`,
            boxShadow: `0 6px 18px ${accentColor}45`,
          }}>
          <Send size={14} />
          {tx(safeLang, 'Göndər', 'Отправить', 'Send')}
        </button>
      </div>
    </section>
  );
}

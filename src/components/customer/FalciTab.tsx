import React from 'react';
import { Capacitor } from '@capacitor/core';
import { Camera as CameraIcon } from 'lucide-react';
import { tx } from '../../i18n';
import { Haptic } from '../../lib/customer_utils';

type Props = {
  safeLang: string;
  fortuneText: string;
  fortuneImage: string;
  fortuneLoading: boolean;
  fortuneProgress: number;
  fortuneStepText: string;
  fileRef: React.RefObject<HTMLInputElement | null>;
  analyzeImageFortune: (file: File) => void;
  takePhotoWithCamera: () => void;
  primaryColor: string;
  isLight?: boolean;
  accentColor: string;
};

export default function FalciTab({
  safeLang, fortuneText, fortuneImage, fortuneLoading, fortuneProgress, fortuneStepText,
  fileRef, analyzeImageFortune, takePhotoWithCamera, primaryColor, accentColor
}: Props) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-white/6 p-5 backdrop-blur-xl space-y-4">
      <style>{`
        @keyframes floatBall {
          0%, 100% { transform: translateY(0px) scale(1); }
          50% { transform: translateY(-8px) scale(1.02); }
        }
        .animate-floatBall {
          animation: floatBall 3s ease-in-out infinite;
        }
      `}</style>

      <div className="flex items-center gap-2">
        <span className="text-xl">🔮</span>
        <div>
          <div className="text-md font-black text-white tracking-tight">AI Falçı</div>
          <div className="text-[11px] text-white/50 font-semibold">{tx(safeLang, 'Bir şəkil yüklə, AI Falçı onun tonuna və ab-havasına baxıb əyləncəli mesaj versin.', 'Загрузи фото, и AI Falçı даст тебе игровое предсказание по атмосфере изображения.', 'Upload an image and AI Fortune Teller will give you a playful reading based on its vibe.')}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">          <button
            type="button"
            onClick={async () => { await Haptic.light(); fileRef.current?.click(); }}
            className="rounded-2xl px-5 py-3 font-black text-[12px] text-slate-950 active:scale-95 transition-transform"
          style={{
            background: `linear-gradient(135deg, ${primaryColor} 0%, ${accentColor} 100%)`,
            boxShadow: `0 4px 12px ${primaryColor}33`
          }}
        >
          {tx(safeLang, 'Şəkil yüklə', 'Загрузить фото', 'Upload image')}
        </button>
        {Capacitor.isNativePlatform() && (
          <button
            type="button"
            onClick={async () => { await Haptic.medium(); takePhotoWithCamera(); }}
            className="flex items-center gap-2 rounded-2xl px-5 py-3 font-black text-[12px] text-slate-950 active:scale-95 transition-transform animate-pulse"
            style={{
              background: `linear-gradient(135deg, ${accentColor} 0%, ${primaryColor} 100%)`,
              boxShadow: `0 4px 12px ${accentColor}33`
            }}
          >
            <CameraIcon size={16} />
            {tx(safeLang, 'Kamera ilə çək', 'Снять на камеру', 'Take Photo')}
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) analyzeImageFortune(file);
        }} />
      </div>

      {fortuneImage && (
        <div className="relative rounded-[24px] overflow-hidden border border-white/10 shadow-2xl">
          <img src={fortuneImage} alt="fortune preview" className="h-48 w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent" />
        </div>
      )}

      {fortuneLoading ? (
        <div className="flex flex-col items-center justify-center py-6 space-y-5 rounded-[24px] bg-slate-950/30 border border-white/5 p-5">
          <div className="relative h-32 w-32 flex items-center justify-center animate-floatBall">
            <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-purple-600/35 via-amber-500/25 to-cyan-500/35 animate-pulse blur-xl" />
            <div className="relative h-28 w-28 rounded-full border border-white/20 bg-white/5 backdrop-blur-md shadow-[0_0_40px_rgba(168,85,247,0.35),_inset_0_4px_16px_rgba(255,255,255,0.2)] flex flex-col items-center justify-center overflow-hidden">
              <div className="absolute inset-2 rounded-full border border-dashed border-white/10 animate-ping opacity-20" />
              <span className="text-2xl font-black text-white">{fortuneProgress}%</span>
              <span className="text-[8px] font-black tracking-widest text-amber-400 uppercase mt-1">
                {tx(safeLang, 'TƏHLİL', 'АНАЛИЗ', 'ANALYSIS')}
              </span>
            </div>
          </div>
          <div className="text-center space-y-2.5 max-w-xs">
            <p className="text-[12px] font-bold text-white tracking-wide animate-pulse">
              {fortuneStepText}
            </p>
            <div className="w-48 h-1 bg-white/10 rounded-full mx-auto overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 via-amber-400 to-cyan-400 transition-all duration-300 rounded-full"
                style={{ width: `${fortuneProgress}%` }}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-[24px] border border-white/5 bg-slate-950/20 p-5 text-[13px] font-medium leading-relaxed text-slate-200">
          {fortuneText ? (
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                <span>🔮</span>
                {tx(safeLang, 'Gələcəyin Səsi', 'Голос Будущего', 'Voice of Future')}
              </p>
              <p className="italic text-slate-100">{fortuneText}</p>
            </div>
          ) : (
            <p className="text-center text-white/40 py-3">
              {tx(safeLang, 'Şəkli yükləyəndən sonra fal burada görünəcək.', 'После загрузки фото предсказание появится здесь.', 'Your fortune will appear here after you upload an image.')}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

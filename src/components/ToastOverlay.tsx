import { X } from 'lucide-react';
import { useAppStore } from '../store';

export default function ToastOverlay() {
  const { toasts, dismissToast } = useAppStore();

  if (!toasts.length) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[120] flex items-end justify-end p-5">
      <div className="flex w-[420px] max-w-[92vw] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="alert"
          aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
          className={`pointer-events-auto rounded-2xl border p-3 shadow-[0_22px_40px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-sm animate-[toastIn_.28s_ease] ${
            toast.type === 'success'
              ? 'border-emerald-300/45 bg-[linear-gradient(165deg,rgba(26,60,46,0.95),rgba(16,28,22,0.97))] text-emerald-100'
              : toast.type === 'error'
              ? 'border-red-300/45 bg-[linear-gradient(165deg,rgba(70,28,32,0.95),rgba(32,16,20,0.97))] text-red-100'
              : 'border-slate-400/45 bg-[linear-gradient(165deg,rgba(63,73,88,0.95),rgba(27,33,44,0.97))] text-slate-100'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold leading-5">{toast.message}</p>
            <button
              onClick={() => dismissToast(toast.id)}
              className="rounded p-1 hover:bg-black/20"
              aria-label="Dismiss toast"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ))}
      </div>
    </div>
  );
}

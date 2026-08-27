import React, { useRef, useState, useEffect } from 'react';
import { tx } from '../../i18n';
import { localPrintAgentHealth } from '../../lib/local_print_agent';

interface ReceiptPreviewProps {
  html: string | null;
  lang: string;
  onClose: () => void;
  onPrint: () => void;
}

export default function ReceiptPreview({ html, lang, onClose, onPrint }: ReceiptPreviewProps) {
  const receiptRef = useRef<HTMLIFrameElement | null>(null);
  const [isAgentOnline, setIsAgentOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    if (html) {
      localPrintAgentHealth()
        .then((online) => {
          if (active) setIsAgentOnline(online);
        })
        .catch(() => {
          if (active) setIsAgentOnline(false);
        });
    }
    return () => {
      active = false;
    };
  }, [html]);

  if (!html) return null;

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/70 p-4">
      <div className="metal-panel w-full max-w-2xl p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-100">{tx(lang, 'Masa Çeki Hazırdır', 'Чек стола готов', 'Table receipt ready')}</h3>
            {isAgentOnline === true && (
              <div className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>{tx(lang, 'Print Agent aktivdir · Çek avtomatik çap edilir', 'Print Agent активен · Чек печатается автоматически', 'Print Agent active · Receipt auto-printed')}</span>
              </div>
            )}
            {isAgentOnline === false && (
              <div className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold text-amber-400">
                <span>⚠️</span>
                <span>{tx(lang, 'Print Agent bağlıdır · Əl ilə çap edə bilərsiniz', 'Print Agent не подключен · Можно распечатать вручную', 'Print Agent offline · You can print manually')}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Show 'Çap Et' button ONLY if Print Agent is NOT active (offline) */}
            {isAgentOnline === false && (
              <button onClick={onPrint} className="rounded-lg bg-yellow-400 px-4 py-2 text-sm font-semibold text-slate-900 active:scale-95 transition">
                {tx(lang, 'Çap Et', 'Печать', 'Print')}
              </button>
            )}
            <button onClick={onClose} className="rounded-lg border border-slate-600 bg-slate-800/80 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-700 active:scale-95 transition">
              {tx(lang, 'Bağla', 'Закрыть', 'Close')}
            </button>
          </div>
        </div>
        <iframe
          ref={receiptRef}
          title="table-receipt"
          srcDoc={html}
          sandbox="allow-same-origin allow-modals allow-popups"
          className="h-[70vh] w-full rounded-lg bg-white"
        />
      </div>
    </div>
  );
}

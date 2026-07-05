import React, { useRef } from 'react';
import { tx } from '../../i18n';

interface ReceiptPreviewProps {
  html: string | null;
  lang: string;
  onClose: () => void;
  onPrint: () => void;
}

export default function ReceiptPreview({ html, lang, onClose, onPrint }: ReceiptPreviewProps) {
  const receiptRef = useRef<HTMLIFrameElement | null>(null);

  if (!html) return null;

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/70 p-4">
      <div className="metal-panel w-full max-w-2xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-100">{tx(lang, 'Masa Çeki Hazırdır', 'Чек стола готов', 'Table receipt ready')}</h3>
          <div className="flex gap-2">
            <button onClick={onPrint} className="rounded-lg bg-yellow-400 px-4 py-2 text-sm font-semibold text-slate-900">{tx(lang, 'Çap Et', 'Печать', 'Print')}</button>
            <button onClick={onClose} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">{tx(lang, 'Bağla', 'Закрыть', 'Close')}</button>
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

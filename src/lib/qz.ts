import { withThermalReceiptPrintCss } from './receipt_print_css';

type QzTrayWindow = Window & {
  qz?: any;
};

const QZ_SCRIPT_SRC = 'https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.js';

const loadQzScript = async () => {
  const w = window as QzTrayWindow;
  if (w.qz) return w.qz;

  await new Promise<void>((resolve, reject) => {
    const exists = document.querySelector(`script[data-qz-tray='1']`) as HTMLScriptElement | null;
    if (exists) {
      exists.addEventListener('load', () => resolve(), { once: true });
      exists.addEventListener('error', () => reject(new Error('QZ script load failed')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = QZ_SCRIPT_SRC;
    script.async = true;
    script.dataset.qzTray = '1';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('QZ script load failed'));
    document.head.appendChild(script);
  });

  if (!(window as QzTrayWindow).qz) {
    throw new Error('QZ Tray library not available');
  }

  return (window as QzTrayWindow).qz;
};

const ensureQzConnection = async (qz: any) => {
  if (!qz?.websocket) throw new Error('QZ websocket not available');
  const active = await qz.websocket.isActive();
  if (!active) {
    await qz.websocket.connect({ retries: 0, delay: 0 });
  }
};

export const qzPrintHtml = async (html: string, printerName?: string) => {
  const qz = await loadQzScript();
  await ensureQzConnection(qz);

  const printer = printerName?.trim()
    ? await qz.printers.find(printerName.trim())
    : await qz.printers.getDefault();

  if (!printer) {
    throw new Error('Printer tapılmadı');
  }

  const config = qz.configs.create(printer, {
    copies: 1,
    scaleContent: true,
  });

  const data = [
    {
      type: 'pixel',
      format: 'html',
      flavor: 'plain',
          data: withThermalReceiptPrintCss(html),
    },
  ];

  await qz.print(config, data);
};

export const qzListPrinters = async (): Promise<string[]> => {
  const qz = await loadQzScript();
  await ensureQzConnection(qz);
  const printers = await qz.printers.find();

  if (!Array.isArray(printers)) {
    return [];
  }

  return printers.map((p: unknown) => String(p)).filter(Boolean);
};

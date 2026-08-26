import { withThermalReceiptPrintCss } from './receipt_print_css';

type QzTrayWindow = Window & {
  qz?: any;
};

// Local copy first: café machines often have slow/blocked internet, and a
// CDN timeout silently makes QZ "unavailable" → browser print window opens even
// though QZ Tray is installed. The vendored copy is in public/qz-tray.js
// (same 2.2.4 build); the CDN is only a fallback behind the local file.
const QZ_SCRIPT_SRC_LOCAL = '/qz-tray.js';
const QZ_SCRIPT_SRC_CDN = 'https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.js';

const QZ_CERT = `-----BEGIN CERTIFICATE-----
MIIDIzCCAgugAwIBAgIUODM1NZjgXFuCsFwm9s46EvGwqJQwDQYJKoZIhvcNAQEL
BQAwITEfMB0GA1UEAwwWaVJvbldhdmVzIFBPUyBQbGF0Zm9ybTAeFw0yNjA1MjYx
MzQ1MDRaFw0zNjA1MjMxMzQ1MDRaMCExHzAdBgNVBAMMFmlSb25XYXZlcyBQT1Mg
UGxhdGZvcm0wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCMB7UFJCQa
wCqkTCMwMv5MOzX+emyiByy5i8BrHoFoH2lUtW1DJhIMBYaMcTH7m7rUQ8ZaStoY
5BXNENizXagFa6+L0f/Jfobmh9YV3la+AG30DCWh34Oq773IzO1vFRIPCYgF2l3d
lnCVKudHtrLonnvA2t+0N2O5idT0Ml9kdb3H9yLoS0SQlQEKVNoWvopUSuNwHx/E
ngE1i4y48iSuPTxgrWjEtB2xqfKRLM2+NzZg7nKxMZOJJfvWenT2d7pLS9LURcq7
ylsFaCfsQCgHZdxPtgcK5YcRe4/J2qiCGKXB1RGB7uykMnUxxadapu6jOuzT9y4T
gpGq2xCrDJdnAgMBAAGjUzBRMB0GA1UdDgQWBBTqHk4tpi9Q26OLRrZ8Z2qHCFKh
hDAfBgNVHSMEGDAWgBTqHk4tpi9Q26OLRrZ8Z2qHCFKhhDAPBgNVHRMBAf8EBTAD
AQH/MA0GCSqGSIb3DQEBCwUAA4IBAQCFBadyRjcSJR+H6VrSCy+1PnsFA3jRyI7K
8fQwo85eJJJyBJWbrd475PphR/8ykGUJ5k41v1OXGAxPKOdu7T5MuZaUN+e/sUqr
/PoxinREGNZvzvaAC1LcdA9+BMd7BkHdceRiUDgtV57k4GHZKzPdYc8IDX6kDR4L
mO218WnTUjbx8nS8F8JDLatKaUIs5VEOcMctiirVKxSpmZuKKvJUGwMs4uhTb7fa
iLy/UMd+AVLu2cEmxm44TtkRwJVrP1/NxY/UzmOkvAfXLMx16QPFMrGYctFGNhsf
89FQL2TLUFagqZkIP6eIdDn5jaqsKZqbPSvG9LW24AFJhmJ8mfkb
-----END CERTIFICATE-----`;

const QZ_PRIVATE_KEY_B64 = `MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCMB7UFJCQawCqk
TCMwMv5MOzX+emyiByy5i8BrHoFoH2lUtW1DJhIMBYaMcTH7m7rUQ8ZaStoY5BXN
ENizXagFa6+L0f/Jfobmh9YV3la+AG30DCWh34Oq773IzO1vFRIPCYgF2l3dlnCV
KudHtrLonnvA2t+0N2O5idT0Ml9kdb3H9yLoS0SQlQEKVNoWvopUSuNwHx/EngE1
i4y48iSuPTxgrWjEtB2xqfKRLM2+NzZg7nKxMZOJJfvWenT2d7pLS9LURcq7ylsF
aCfsQCgHZdxPtgcK5YcRe4/J2qiCGKXB1RGB7uykMnUxxadapu6jOuzT9y4TgpGq
2xCrDJdnAgMBAAECggEAQRmEKrO2pUkZifBrm4jZeI8+duRrhJhZTpmOBz7TYpjX
2y3Nch5M3ZHkD37AgfzQSsaHfIq4AkJncEKYvCqaZoq9vf8PL5nHFX2pJdmL8iE4
/PB4vlyvVdTHIodDCxV8o8kGl9IBOXcrN+4OP+TMICEt32biAWKO1j8h5bVVa9ox
JOBZTIxhAz7cYtUwinP/SUH8YC22qENetAaEesWeBTxlpoF6EZZwOafKIB3qYNDR
kbTl9ZHCQYsNd7DrZN2whKgbHDEDQIlCoE5wHmjgUFlPWUHuOa670clXQAaVO0j+
lVgCQv7fqWx7N5qgIA2CMnNxSjoCs9DRLMNuui6RwQKBgQC/8f0TSlkwXeoxoj1T
K4W4bxAIvTWXcodxcFghAbZjN1JvLGWngrH0jLd7A38McthhbGeHf9EwmbQg3z8P
eYpJZe+WW3AHXgbND+Y5Pi+P3yCtlcqKusld1/Q0/4iOpKgGvieGpNtZ5vXJWXvp
8vQi5R8i4kV1R+AqFvVQcpNZiQKBgQC6wpJkeOT1UHrAmro7zj8XFfxlHcV606rj
Dv78hrfMzOcDW4sAc2A3mG16WAE4C7i/5QvPx+FP6yG9XeM2ykC2ac7phb1mugzL
r4ZMRiMoQzYHAy1DSBpd/I1cqTNN+hb4XHOAwXC3EW0p6WEq6hZ2G21Tl7qNoEhk
K4CxWhJdbwKBgQCmj7DSmoPGqthc9bJNh8jkAMxjKP1mTGYoFBsFmVzRv+Hyww37
TDhsQ+e8AY6wGMCX2eAE/u9iQx7CH7ezD/7mLmS3juUqH3e7Xn6jUckoCbFrsD4w
IGI44vrxOoUfctaz8zKNbmVCIF9MuDAFFWSxGy3nsX4ghZyKKZ36j1I6MQKBgQCd
8DQbMb3206OrxG4ga5AhNt+mp6G8+Mo4kRMEfe1sDhCDX2RS8j95ZLeY0lnditQn
vEzb395kVqXG3mJrkGlfmmV4STjeahKuIndBg8Lxpr1G+uHJV22s9AqcRR71H71T
NeQcC/sFZoBaBFq/Dw4FvbYcDmGeqeDujXedBF4pkwKBgFM/m4IGjhW7ABPZqd42
jgbVpfZzepaOPWdsqzcMaDsDq09mVlvkRgIhbcgQ33kJTd7JhFgZXNDH9620iGIW
H4I3HZFx9AwuAXvhZ4whxUWmk8QjpJJOcjRQIfF99yUVqlOrG9PnTBItNP/eFziK
RkeYXLmf1nZVfrOy85Fb7JU+`;

let cryptoKeyCache: CryptoKey | null = null;

const getCryptoKey = async (): Promise<CryptoKey> => {
  if (cryptoKeyCache) return cryptoKeyCache;
  const rawBinary = atob(QZ_PRIVATE_KEY_B64.replace(/\s+/g, ''));
  const keyBuffer = new Uint8Array(rawBinary.length);
  for (let i = 0; i < rawBinary.length; i++) {
    keyBuffer[i] = rawBinary.charCodeAt(i);
  }
  cryptoKeyCache = await window.crypto.subtle.importKey(
    'pkcs8',
    keyBuffer.buffer,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign']
  );
  return cryptoKeyCache;
};

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

    const sources = [QZ_SCRIPT_SRC_LOCAL, QZ_SCRIPT_SRC_CDN];
    let index = 0;
    const tryNext = (): void => {
      if (index >= sources.length) {
        reject(new Error('QZ script load failed'));
        return;
      }
      const script = document.createElement('script');
      script.src = sources[index];
      script.async = true;
      script.dataset.qzTray = '1';
      script.onload = () => resolve();
      script.onerror = () => {
        script.remove();
        index += 1;
        tryNext();
      };
      document.head.appendChild(script);
    };
    tryNext();
  });

  if (!(window as QzTrayWindow).qz) {
    throw new Error('QZ Tray library not available');
  }

  const qz = (window as QzTrayWindow).qz;

  // Configure QZ security promises
  qz.security.setCertificatePromise((resolve: any) => {
    resolve(QZ_CERT);
  });

  qz.security.setSignatureAlgorithm('SHA256');
  qz.security.setSignaturePromise((toSign: string) => {
    return (resolve: any, reject: any) => {
      getCryptoKey()
        .then((key) => {
          const encoder = new TextEncoder();
          const data = encoder.encode(toSign);
          window.crypto.subtle
            .sign(
              {
                name: 'RSASSA-PKCS1-v1_5',
                hash: 'SHA-256',
              },
              key,
              data
            )
            .then((signature) => {
              const base64Sig = btoa(String.fromCharCode(...new Uint8Array(signature)));
              resolve(base64Sig);
            })
            .catch(reject);
        })
        .catch(reject);
    };
  });

  return qz;
};

const ensureQzConnection = async (qz: any) => {
  if (!qz?.websocket) throw new Error('QZ websocket not available');
  try {
    const active = await qz.websocket.isActive();
    if (active) return;
  } catch {}

  try {
    await qz.websocket.connect({ retries: 2, delay: 1 });
  } catch (err: any) {
    try {
      await qz.websocket.connect({
        host: 'localhost',
        usingSecure: window.location.protocol === 'https:',
        retries: 2,
        delay: 1,
      });
    } catch (fallbackErr: any) {
      throw new Error(err?.message || fallbackErr?.message || 'QZ Tray-ə qoşulmaq mümkün olmadı');
    }
  }
};

export const qzCheckStatus = async (): Promise<{
  online: boolean;
  version?: string;
  printers: string[];
  error?: string;
  errorKind?: 'script' | 'connection' | 'signature';
}> => {
  try {
    const qz = await loadQzScript();
    await ensureQzConnection(qz);
    const version = (await qz.api?.getVersion?.().catch(() => '2.2.4')) || '2.2.4';
    const printersRaw = await qz.printers.find().catch(() => []);
    const printers = Array.isArray(printersRaw) ? printersRaw.map((p) => String(p)).filter(Boolean) : [];
    return {
      online: true,
      version: String(version),
      printers,
    };
  } catch (err: any) {
    const msg = err?.message || String(err);
    let errorKind: 'script' | 'connection' | 'signature' = 'connection';
    if (/script load failed|script not loaded/i.test(msg)) {
      errorKind = 'script';
    } else if (/signature|security|certificate|crypto/i.test(msg)) {
      errorKind = 'signature';
    }
    return {
      online: false,
      printers: [],
      error: msg,
      errorKind,
    };
  }
};

export const resolveQzPrinter = async (qz: any, printerName?: string): Promise<any> => {
  let printer: any = null;
  const targetName = String(printerName || '').trim();

  if (targetName) {
    try {
      printer = await qz.printers.find(targetName);
    } catch {
      try {
        const allPrinters = await qz.printers.find();
        if (Array.isArray(allPrinters)) {
          printer = allPrinters.find((p: string) =>
            p.toLowerCase().includes(targetName.toLowerCase()) || targetName.toLowerCase().includes(p.toLowerCase())
          );
        }
      } catch {}
    }
  }

  if (!printer) {
    try {
      printer = await qz.printers.getDefault();
    } catch {}
  }

  if (!printer) {
    const all = await qz.printers.find().catch(() => []);
    if (Array.isArray(all) && all.length > 0) {
      printer = all[0];
    }
  }

  if (!printer) {
    throw new Error('QZ Tray sistemində heç bir printer tapılmadı');
  }

  return printer;
};

export const qzPrintHtml = async (
  html: string,
  options?: { printerName?: string; paperWidth?: '58mm' | '80mm' } | string
) => {
  const targetName = typeof options === 'string' ? options : options?.printerName;
  const paperWidth = typeof options === 'object' ? options?.paperWidth : undefined;

  const qz = await loadQzScript();
  await ensureQzConnection(qz);
  const printer = await resolveQzPrinter(qz, targetName);

  const is58 = (paperWidth || '58mm') === '58mm';
  const widthMm = is58 ? 48 : 72;
  // Kağızın effektiv piksel eni (≈203 DPI).
  const pxWidth = is58 ? 384 : 576;

  // thermal CSS "html,body{width:100%!important}" təyin edir. QZ-in daxili HTML
  // rasterlaşdırıcısı bu "100%"-i kağızdan geniş viewporta hesablayıb sağ kənarın
  // kəsilməsinə, başlıq/QR-nin əyri və ya kənarə itməsinə səbəb olur. Kök eni
  // birbaşa kağız piksel eninə məcburi edirik (thermal CSS-dən SONRA).
  let styled = withThermalReceiptPrintCss(html);
  const widthOverride = `<style data-qz-width="1">html,body{width:${pxWidth}px!important;max-width:${pxWidth}px!important;}</style>`;
  styled = styled.replace(/<\/head>/i, `${widthOverride}</head>`);

  // Strategiya: HTML-i brauzerdə sabit enə render edib html2canvas ilə PNG-yə
  // çeviririk, sonra QZ-ə ŞƏKİL kimi göndəririk. Bu, QZ-in HTML raster xətalarını
  // (kəsilmə, 90° çevrilmə, başlıq/loqo/barkod/QR itkisi) tam aradan qaldırır —
  // çünki dizayn bizim brauzerimizdə eyni kimi çap olunur.
  try {
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await rasterizeHtmlToCanvas(styled, pxWidth, html2canvas);
    const pngDataUrl = canvas.toDataURL('image/png');
    const base64 = String(pngDataUrl || '').split(',')[1] || '';
    if (!base64) throw new Error('PNG çap olunmadı (boş məzmun)');

    const config = qz.configs.create(printer, {
      copies: 1,
      orientation: 'portrait',
      units: 'mm',
      size: { width: widthMm },
      margins: 0,
      scaleContent: true,
      interpolation: 'nearest',
    });
    const data = [
      {
        type: 'pixel',
        format: 'image',
        flavor: 'base64',
        data: base64,
      },
    ];
    await qz.print(config, data);
    return;
  } catch (rasterErr) {
    // Ehtiyat: şəkil yolu alınmadısa (html2canvas dəstəklənməyən CSS və s.),
    // əvvəlki HTML-pixel üsuluna qayıdırıq ki, çap heç olmazsa gerçəkləşsin.
    console.warn('QZ HTML→PNG rasterlaşdırma uğursuz, HTML-pixel ehtiyatına keçilir:', rasterErr);
  }

  // Ehtiyat yolu: QZ-nin daxili HTML rasterlaşdırıcısı (geniş uyğunluq üçün).
  const config = qz.configs.create(printer, {
    copies: 1,
    orientation: 'portrait',
    units: 'mm',
    size: { width: widthMm, height: 1000 },
    margins: 0,
    scaleContent: true,
    rasterize: true,
    interpolation: 'nearest',
  });
  const data = [
    {
      type: 'pixel',
      format: 'html',
      flavor: 'plain',
      data: styled,
    },
  ];
  await qz.print(config, data);
};

// HTML-i verilmiş en daxilində render edib Canvas-a çevirir (html2canvas istifadə edir).
// Gizli iframe-də tam sənəd kimi render olunur ki, <head> üslubları dəqiq tətbiq edilsin.
async function rasterizeHtmlToCanvas(
  htmlDoc: string,
  pxWidth: number,
  html2canvas: any
): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${pxWidth}px;height:10px;border:0;visibility:hidden;opacity:0;pointer-events:none;`;

    const cleanup = () => {
      try {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      } catch {}
    };

    const onError = (reason: unknown) => {
      cleanup();
      reject(reason instanceof Error ? reason : new Error(String(reason)));
    };

    iframe.onload = async () => {
      try {
        const doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
        if (!doc || !doc.body) throw new Error('iframe sənədi mövcud deyil');

        // Kök eni məcburi edirik ki, məzmun pxWidth daxilində sığsın.
        const fix = doc.createElement('style');
        fix.textContent = `html,body{width:${pxWidth}px!important;max-width:${pxWidth}px!important;margin:0!important;padding-left:0!important;padding-right:0!important;}`;
        doc.head.appendChild(fix);

        // Şəkillərin (loqo/barkod/QR) yüklənməsini gözləyirik.
        await waitForImagesInDocument(doc);

        const canvas = await html2canvas(doc.body, {
          width: pxWidth,
          windowWidth: pxWidth,
          backgroundColor: '#ffffff',
          scale: 2,
          logging: false,
          useCORS: true,
          allowTaint: false,
        });
        cleanup();
        resolve(canvas);
      } catch (e) {
        onError(e);
      }
    };
    iframe.onerror = () => onError(new Error('iframe yüklənmədi'));

    document.body.appendChild(iframe);
    const idoc = iframe.contentDocument;
    if (!idoc) return onError(new Error('iframe contentDocument alınmadı'));
    idoc.open();
    idoc.write(htmlDoc);
    idoc.close();
  });
}

// Sənəddəki bütün <img>/<image> elementlərinin yüklənməsini gözləyir.
function waitForImagesInDocument(doc: Document): Promise<void> {
  const imgs = Array.from(doc.images || []);
  if (imgs.length === 0) return Promise.resolve();
  return Promise.all(
    imgs.map((img) => {
      if ((img as HTMLImageElement).complete) return Promise.resolve();
      return new Promise<void>((res) => {
        const done = () => res();
        (img as HTMLImageElement).addEventListener('load', done, { once: true });
        (img as HTMLImageElement).addEventListener('error', done, { once: true });
        // Təhlükəsizlik vaxtı: 4s sonra yüklənməsə də davam et.
        window.setTimeout(done, 4000);
      });
    })
  ).then(() => undefined);
}

export const qzPrintRaw = async (commands: string, printerName?: string) => {
  const qz = await loadQzScript();
  await ensureQzConnection(qz);
  const printer = await resolveQzPrinter(qz, printerName);

  const config = qz.configs.create(printer, {
    copies: 1,
  });

  // IMPORTANT: Use base64 flavor to safely transmit binary ESC/POS data.
  // flavor:'plain' encodes the string as UTF-8 over WebSocket, which corrupts
  // any bytes ≥ 0x80 (common in QR bitmaps built with String.fromCharCode).
  // btoa() works because every byte in our ESC/POS string is in 0x00-0xFF range.
  const data = [
    {
      type: 'raw',
      format: 'command',
      flavor: 'base64',
      data: btoa(commands),
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


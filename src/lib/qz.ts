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

  const config = qz.configs.create(printer, {
    copies: 1,
    size: { width: widthMm },
    units: 'mm',
    margins: 0,
    scaleContent: true,
    rasterize: true,
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

export const qzPrintRaw = async (commands: string, printerName?: string) => {
  const qz = await loadQzScript();
  await ensureQzConnection(qz);
  const printer = await resolveQzPrinter(qz, printerName);

  const config = qz.configs.create(printer, {
    copies: 1,
  });

  const data = [
    {
      type: 'raw',
      format: 'command',
      flavor: 'plain',
      data: commands,
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


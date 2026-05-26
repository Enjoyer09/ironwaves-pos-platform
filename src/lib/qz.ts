import { withThermalReceiptPrintCss } from './receipt_print_css';

type QzTrayWindow = Window & {
  qz?: any;
};

const QZ_SCRIPT_SRC = 'https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.js';

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

  const qz = (window as QzTrayWindow).qz;

  // Configure QZ security promises
  qz.security.setCertificatePromise((resolve: any) => {
    resolve(QZ_CERT);
  });

  qz.security.setSignatureAlgorithm('SHA256');
  qz.security.setSignaturePromise((toSign: string) => {
    return new Promise(async (resolve, reject) => {
      try {
        const key = await getCryptoKey();
        const encoder = new TextEncoder();
        const data = encoder.encode(toSign);
        const signature = await window.crypto.subtle.sign(
          {
            name: 'RSASSA-PKCS1-v1_5',
            hash: 'SHA-256',
          },
          key,
          data
        );
        const base64Sig = btoa(String.fromCharCode(...new Uint8Array(signature)));
        resolve(base64Sig);
      } catch (err) {
        reject(err);
      }
    });
  });

  return qz;
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

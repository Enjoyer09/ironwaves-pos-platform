// E6.1 — Hüquqi səhifələr (App Store 5.1.1).
//
// Səhifələr `public/legal/*.html` altında statik fayldır; build-də `dist/legal/`
// içinə köçürülür və `server.js` onları həmin origin-dən verir. Yəni ayrı host
// lazım deyil — eyni tenant domeni kifayətdir.
//
// `LEGAL_PAGES_HOSTED` false olduqda profil sətri "hazırlanır" göstərir və
// istifadəçiyə 404 açmırıq. Səhifələr yerləşdirildikdən sonra yalnız bu bayrağı
// true etmək kifayətdir.
export const LEGAL_PAGES_HOSTED = false;

/** Native tətbiqdə origin `capacitor://localhost` olur və nisbi yol işləmir;
 *  bu halda istifadəçinin konfiqurasiya etdiyi tenant domeninə düşürük. */
const FALLBACK_ORIGIN = 'https://super.ironwaves.store';

function resolveOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.protocol?.startsWith('http')) {
    return window.location.origin;
  }
  try {
    const saved = String(localStorage.getItem('mobile_tenant_domain') || '').trim();
    if (saved) return `https://${saved.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
  } catch {
    /* localStorage əlçatmazdır — fallback kifayətdir */
  }
  return FALLBACK_ORIGIN;
}

export const LEGAL_PRIVACY_URL = `${resolveOrigin()}/legal/privacy.html`;
export const LEGAL_TERMS_URL = `${resolveOrigin()}/legal/terms.html`;

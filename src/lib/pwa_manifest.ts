/**
 * Dynamic White-Label PWA Manifest Updater
 * Injects tenant's custom company name, logo and branding into browser PWA manifest
 * at runtime so Chrome's 'Install app' prompt displays the exact tenant logo and name.
 */

let lastManifestBlobUrl: string | null = null;

export function updateDynamicPwaManifest(opts: {
  companyName?: string;
  logoUrl?: string;
  subdomain?: string;
}): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const rawName = String(opts.companyName || '').trim();
  const host = window.location.hostname.toLowerCase();

  let formattedName = 'iRonWaves POS Platform';
  let formattedShortName = 'iRonWaves POS';

  if (rawName) {
    formattedName = rawName.toLowerCase().includes('pos') ? rawName : `${rawName} POS`;
    formattedShortName = rawName.length > 20 ? rawName.slice(0, 20) : rawName;
  } else if (host.endsWith('.ironwaves.store')) {
    const sub = host.replace('.ironwaves.store', '').trim();
    if (sub && sub !== 'www' && sub !== 'api' && sub !== 'menu' && sub !== 'super') {
      const parts = sub
        .split(/[-_]+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
      formattedName = `${parts} POS`;
      formattedShortName = `${parts} POS`;
    }
  }

  const logo = String(opts.logoUrl || '').trim();

  const manifestObj = {
    name: formattedName,
    short_name: formattedShortName,
    description: `${formattedName} — Point of Sale & Restaurant Management`,
    theme_color: '#0f172a',
    background_color: '#020617',
    display: 'standalone',
    orientation: 'any',
    start_url: '/',
    scope: '/',
    categories: ['food', 'business', 'point of sale'],
    prefer_related_applications: false,
    icons: logo
      ? [
          {
            src: logo,
            sizes: '192x192',
            type: logo.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png',
            purpose: 'any',
          },
          {
            src: logo,
            sizes: '512x512',
            type: logo.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png',
            purpose: 'any',
          },
          {
            src: logo,
            sizes: '512x512',
            type: logo.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png',
            purpose: 'any maskable',
          },
        ]
      : [
          {
            src: '/ironwaves-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/ironwaves-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/ironwaves-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
  };

  try {
    if (lastManifestBlobUrl) {
      try {
        URL.revokeObjectURL(lastManifestBlobUrl);
      } catch {}
    }
    const blob = new Blob([JSON.stringify(manifestObj, null, 2)], {
      type: 'application/manifest+json',
    });
    const blobUrl = URL.createObjectURL(blob);
    lastManifestBlobUrl = blobUrl;

    let linkTag = document.querySelector('link[rel="manifest"]') as HTMLLinkElement;
    if (!linkTag) {
      linkTag = document.createElement('link');
      linkTag.rel = 'manifest';
      document.head.appendChild(linkTag);
    }
    linkTag.href = blobUrl;

    // Also update dynamic favicon and apple-touch-icon if tenant logo is available
    if (logo) {
      let iconTag = document.querySelector('link[rel="icon"]') as HTMLLinkElement;
      if (iconTag) iconTag.href = logo;
      let appleIcon = document.querySelector('link[rel="apple-touch-icon"]') as HTMLLinkElement;
      if (!appleIcon) {
        appleIcon = document.createElement('link');
        appleIcon.rel = 'apple-touch-icon';
        document.head.appendChild(appleIcon);
      }
      appleIcon.href = logo;
    }
  } catch (err) {
    console.warn('Could not update dynamic PWA manifest:', err);
  }
}

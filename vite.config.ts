import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig(({ command }) => {
  if (command === "build") {
    const apiBase = String(process.env.VITE_API_BASE_URL || "").trim();
    if (!apiBase) {
      throw new Error(
        "VITE_API_BASE_URL konfiqurasiya edilməyib. Build üçün environment dəyişəni mütləq verilməlidir."
      );
    }
  }

  return {
    plugins: [
      react(),
      tailwindcss(),

      // ── Progressive Web App / Service Worker ───────────────────────────────
      // Caches the app shell (JS, CSS, HTML) so the app loads offline.
      // API requests are always NetworkOnly — we never serve stale auth/data.
      // The generated dist/sw.js replaces the retirement worker in public/sw.js.
      // ──────────────────────────────────────────────────────────────────────
      VitePWA({
        registerType: "autoUpdate",
        injectRegister: "auto",

        workbox: {
          // Cache app-shell assets: JS bundles, CSS, HTML, fonts, small icons.
          // Large media files (landing page images, downloads) are excluded —
          // they are not part of the app shell and exceed the 2 MiB limit.
          globPatterns: ["**/*.{js,css,html,woff2,svg,ico}"],
          globIgnores: ["landing/**", "downloads/**"],

          // For SPA navigation: serve index.html for any URL the SW controls
          navigateFallback: "index.html",

          // Do NOT intercept API calls, file downloads or health-check endpoints
          navigateFallbackDenylist: [
            /^\/api\//,
            /^\/downloads\//,
            /^\/health/,
          ],

          runtimeCaching: [
            {
              // Backend API — always go to the network, never cache
              urlPattern: /\/api\//,
              handler: "NetworkOnly",
            },
            {
              // Google Fonts stylesheet — stale-while-revalidate, 1-year TTL
              urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "iw-gfonts-css-v1",
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // Google Fonts binary assets — cache-first, 1-year TTL
              urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
              handler: "CacheFirst",
              options: {
                cacheName: "iw-gfonts-assets-v1",
                expiration: {
                  maxEntries: 30,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],

          // Remove caches from previous SW versions on activation
          cleanupOutdatedCaches: true,
          // Activate new SW immediately — don't wait for old tabs to close
          skipWaiting: true,
          clientsClaim: true,
        },

        manifest: {
          name: "iRonWaves POS",
          short_name: "IW POS",
          description: "iRonWaves Point of Sale System",
          theme_color: "#0f172a",
          background_color: "#0f172a",
          display: "standalone",
          orientation: "any",
          start_url: "/",
          scope: "/",
          categories: ["business", "finance"],
          prefer_related_applications: false,
          icons: [
            {
              src: "vite.svg",
              sizes: "any",
              type: "image/svg+xml",
              purpose: "any",
            },
          ],
        },

        // Never activate the SW in development — avoids breaking Vite HMR
        devOptions: {
          enabled: false,
        },
      }),
    ],

    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },

    build: {
      target: "es2020",
      sourcemap: false,
      cssCodeSplit: true,
      assetsInlineLimit: 4096,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom", "react-router-dom"],
            charts: ["recharts"],
            i18n: ["i18next", "react-i18next"],
            qr: ["qrcode", "jsbarcode"],
            zip: ["jszip"],
            decimal: ["decimal.js"],
            icons: ["lucide-react"],
          },
        },
      },
    },
  };
});

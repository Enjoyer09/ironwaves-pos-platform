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
      console.warn(
        "VITE_API_BASE_URL konfiqurasiya edilməyib. Production runtime default backend URL istifadə edəcək."
      );
    }
  }

  return {
    plugins: [
      react(),
      tailwindcss(),

      // ── Service Worker retirement ─────────────────────────────────────────
      // POS must never keep an old app-shell while live tables are changing.
      // This deploy ships an unregistering SW and clears old Workbox caches.
      // ──────────────────────────────────────────────────────────────────────
      VitePWA({
        injectRegister: "auto",
        selfDestroying: true,

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

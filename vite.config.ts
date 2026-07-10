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
  const isCustomerOnlyBuild = String(process.env.VITE_CUSTOMER_APP_ONLY || "").trim() === "1";
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
          display: "fullscreen",
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
        // In non-native environments (web dev / CI), stub out the optional
        // Capacitor background-task plugin so Vite's import analysis doesn't crash.
        // On iOS native, Capacitor resolves this at runtime — the dynamic import
        // in background_fetch.ts catches null gracefully.
        "@capacitor/background-task": path.resolve(
          __dirname,
          "src/lib/stubs/capacitor-background-task.ts"
        ),
      },
    },

    build: {
      target: "es2020",
      sourcemap: false,
      cssCodeSplit: true,
      assetsInlineLimit: 4096,
      rollupOptions: {
        external: ['@capacitor/background-task'],
        ...(isCustomerOnlyBuild
          ? {
              input: path.resolve(__dirname, "customer.html"),
            }
          : {}),
      },
      minify: "terser",
      terserOptions: {
        compress: {
          drop_console: true,
          drop_debugger: true,
        },
      },
    },

    // Exclude optional Capacitor plugins that are not installed as npm packages
    // (they are resolved at native runtime only — not via node_modules)
    optimizeDeps: {
      exclude: ['@capacitor/background-task'],
    },
  };
});

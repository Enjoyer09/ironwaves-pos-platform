import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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

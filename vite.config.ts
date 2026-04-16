import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

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
      viteSingleFile(),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
  };
});

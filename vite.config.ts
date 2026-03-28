import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { VitePWA } from "vite-plugin-pwa";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(), 
    tailwindcss(), 
    viteSingleFile(),
    VitePWA({
      injectRegister: false,
      registerType: 'autoUpdate',
      devOptions: {
        enabled: true
      },
      manifest: {
        name: 'Emalatkhana POS',
        short_name: 'POS',
        description: 'Enterprise POS System',
        theme_color: '#ea580c',
        icons: [
          {
            src: 'https://cdn-icons-png.flaticon.com/512/3126/3126647.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'https://cdn-icons-png.flaticon.com/512/3126/3126647.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});

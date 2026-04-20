import { createRoot } from "react-dom/client";
import "./index.css";
import "./i18n";
import App from "./App";
import AppErrorBoundary from "./components/AppErrorBoundary";

function renderBootError(message: string) {
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f172a;padding:24px;color:#e2e8f0;font-family:system-ui,sans-serif;">
      <div style="max-width:720px;width:100%;background:rgba(15,23,42,.88);border:1px solid rgba(248,250,252,.14);border-radius:18px;padding:24px;box-shadow:0 24px 60px rgba(0,0,0,.45);">
        <h1 style="margin:0 0 12px;font-size:28px;font-weight:800;">iRonWaves POS</h1>
        <p style="margin:0 0 10px;font-size:16px;">Tətbiq açılarkən xəta baş verdi.</p>
        <pre style="white-space:pre-wrap;word-break:break-word;background:#020617;border-radius:12px;padding:14px;font-size:13px;color:#fda4af;">${message}</pre>
        <button onclick="window.location.reload()" style="margin-top:16px;border:0;border-radius:12px;padding:12px 18px;background:#facc15;color:#111827;font-weight:700;cursor:pointer;">Yenidən yoxla</button>
      </div>
    </div>
  `;
}

window.addEventListener("error", (event) => {
  const message = event.error instanceof Error ? `${event.error.name}: ${event.error.message}` : String(event.message || "Unknown startup error");
  renderBootError(message);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason instanceof Error ? `${event.reason.name}: ${event.reason.message}` : String(event.reason || "Unhandled promise rejection");
  renderBootError(reason);
});

try {
  const rootNode = document.getElementById("root");
  if (!rootNode) {
    throw new Error("Root element tapılmadı");
  }

  createRoot(rootNode).render(
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  );
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  renderBootError(message);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        void registration.unregister();
      });
    }).catch(() => {
      // Ignore cleanup failures.
    });

    if ("caches" in window) {
      caches.keys().then((keys) => {
        keys.forEach((key) => {
          void caches.delete(key);
        });
      }).catch(() => {
        // Ignore cache cleanup failures.
      });
    }
  });
}

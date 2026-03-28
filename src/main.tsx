import { createRoot } from "react-dom/client";
import "./index.css";
import "./i18n";
import App from "./App";
import AppErrorBoundary from "./components/AppErrorBoundary";

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Temporary stabilization:
    // production clients were getting inconsistent boot behavior across browsers,
    // so we explicitly remove older SW/caches instead of registering a new one.
    void navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        void registration.unregister();
      });
    });

    if ('caches' in window) {
      void caches.keys().then((keys) => {
        keys.forEach((key) => {
          void caches.delete(key);
        });
      });
    }
  });
}

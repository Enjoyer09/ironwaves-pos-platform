import React from 'react';
import { logUiError } from '../lib/logger';
import { readScopedStorage, removeScopedStorage } from '../lib/storage_keys';

type Props = {
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
  errorMessage: string;
};

export default class AppErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // Guard the app shell and keep user in control.
    console.error('UI crash captured by ErrorBoundary:', error);
    const message = error instanceof Error ? error.message : String(error);
    this.setState({ errorMessage: message });
    try {
      const raw = readScopedStorage('emalatkhana-pos-session');
      const parsed = raw ? JSON.parse(raw) : null;
      const tenant = parsed?.state?.user?.tenant_id || 'tenant_default';
      logUiError(tenant, 'app-shell', message, {
        stack: error instanceof Error ? error.stack : undefined,
      });
    } catch {
      // ignore telemetry failures
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center p-6 text-slate-100">
          <div className="metal-panel w-full max-w-xl p-6 text-center">
            <h2 className="text-2xl font-bold">UI xətası baş verdi</h2>
            <p className="mt-2 text-slate-300">
              Səhifəni yeniləyin. Problem davam edərsə təhlükəsiz sıfırlama edin.
            </p>
            {this.state.errorMessage ? (
              <div className="mt-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-left text-sm text-red-100">
                {this.state.errorMessage}
              </div>
            ) : null}
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button
                onClick={() => window.location.reload()}
                className="glossy-gold rounded-lg px-4 py-2 font-semibold"
              >
                Yenilə
              </button>
              <button
                onClick={() => {
                  try {
                    removeScopedStorage('emalatkhana-pos-session');
                    // Also clear potentially corrupted tenant-scoped runtime caches.
                    Object.keys(localStorage)
                      .filter((key) =>
                        key.includes('_pos_') ||
                        key.includes('_admin_notes') ||
                        key.includes('finance_subject_presets_') ||
                        key.includes('ui_auto_reload_once'),
                      )
                      .forEach((key) => localStorage.removeItem(key));
                  } catch {
                    // ignore storage cleanup errors
                  }
                  window.location.reload();
                }}
                className="neon-btn rounded-lg px-4 py-2"
              >
                Təhlükəsiz sıfırla
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

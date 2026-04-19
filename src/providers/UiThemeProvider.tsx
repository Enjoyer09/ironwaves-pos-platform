import React from 'react';
import { get_settings } from '../api/settings';
import { useAppStore } from '../store';
import { getActiveTenantId } from '../lib/tenant';
import { cleanUiMode, type UiMode, themeTokensByMode } from '../theme/modes';

type UiThemeContextValue = {
  uiMode: UiMode;
  setUiMode: (mode: UiMode) => void;
};

const UiThemeContext = React.createContext<UiThemeContextValue>({
  uiMode: 'old',
  setUiMode: () => undefined,
});

function resolveTenantUiMode(tenantId?: string): UiMode {
  const settings = get_settings(tenantId);
  return cleanUiMode(settings?.session_settings?.ui_mode);
}

export function UiThemeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAppStore();
  const resolvedTenant = String(user?.tenant_id || getActiveTenantId() || '').trim();
  const [uiMode, setUiModeState] = React.useState<UiMode>(() => resolveTenantUiMode(resolvedTenant));

  React.useEffect(() => {
    setUiModeState(resolveTenantUiMode(resolvedTenant));
  }, [resolvedTenant]);

  React.useEffect(() => {
    const onSettingsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ tenant_id?: string }>).detail;
      const eventTenant = String(detail?.tenant_id || resolvedTenant || '').trim();
      if (!eventTenant || !resolvedTenant || eventTenant === resolvedTenant) {
        setUiModeState(resolveTenantUiMode(resolvedTenant));
      }
    };
    window.addEventListener('settings-updated', onSettingsUpdated as EventListener);
    return () => window.removeEventListener('settings-updated', onSettingsUpdated as EventListener);
  }, [resolvedTenant]);

  React.useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-ui-mode', uiMode);
    const tokens = themeTokensByMode[uiMode];
    root.style.setProperty('--ui-accent-primary', tokens.accent.primary);
    root.style.setProperty('--ui-accent-success', tokens.accent.success);
    root.style.setProperty('--ui-accent-danger', tokens.accent.danger);
    root.style.setProperty('--ui-text-primary', tokens.text.primary);
    root.style.setProperty('--ui-text-secondary', tokens.text.secondary);
    root.style.setProperty('--ui-panel-border', tokens.surface.panelBorder);
  }, [uiMode]);

  const setUiMode = React.useCallback((mode: UiMode) => {
    setUiModeState(cleanUiMode(mode));
  }, []);

  return (
    <UiThemeContext.Provider value={{ uiMode, setUiMode }}>
      {children}
    </UiThemeContext.Provider>
  );
}

export function useUiTheme() {
  return React.useContext(UiThemeContext);
}


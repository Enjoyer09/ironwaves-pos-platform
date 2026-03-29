import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Lang } from './i18n';
import { authApi } from './api/auth';
import { logEvent } from './lib/logger';
import { getActiveTenantId, setActiveTenantId } from './lib/tenant';
import { LoginRiskContext } from './lib/risk';
import { hostScopedKey } from './lib/storage_keys';

export interface UserSession {
  username: string;
  role: string;
  tenant_id?: string;
}

export interface CartItem {
  id: string;
  item_name: string;
  price: string;
  category: string;
  is_coffee: boolean;
  qty: number;
}

interface AppState {
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  lang: Lang;
  setLang: (lang: Lang) => void;
  
  user: UserSession | null;
  access_token: string | null;
  refresh_token: string | null;
  login: (pin: string) => Promise<boolean>;
  adminLogin: (username: string, password: string, secondFactorPin: string, riskContext?: LoginRiskContext) => Promise<boolean>;
  adminNeeds2FA: boolean;
  authErrorMessage: string;
  clearAuthError: () => void;
  logout: () => void;
  switchTenantContext: (tenantId: string) => void;
  
  cart: CartItem[];
  addToCart: (item: any) => void;
  removeFromCart: (id: string) => void;
  updateCartItem: (id: string, qty: number) => void;
  clearCart: () => void;

  toasts: { id: string; type: 'success' | 'error' | 'info'; message: string }[];
  notify: (type: 'success' | 'error' | 'info', message: string) => void;
  dismissToast: (id: string) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),
      lang: 'az',
      setLang: (lang) => set({ lang: (lang === 'az' || lang === 'ru' || lang === 'en') ? lang : 'az' }),
      
      user: null,
      access_token: null,
      refresh_token: null,
      adminNeeds2FA: false,
      authErrorMessage: '',
      clearAuthError: () => set({ authErrorMessage: '', adminNeeds2FA: false }),
      
      login: async (pin: string) => {
        try {
          const tenantId = getActiveTenantId();
          const res = await authApi.pin_login(pin, tenantId);
          if (res?.user?.tenant_id) {
            setActiveTenantId(res.user.tenant_id);
          }
          set({ user: res.user, access_token: res.access_token, refresh_token: res.refresh_token || null });
          return true;
        } catch (error: any) {
          console.error("Login xətası:", error.message);
          return false;
        }
      },

      adminLogin: async (username: string, password: string, secondFactorPin: string, riskContext?: LoginRiskContext) => {
        try {
          const tenantId = getActiveTenantId();
          const res = await authApi.password_login(username, password, secondFactorPin, tenantId, riskContext);
          const resolvedTenant = (res.user as any)?.tenant_id || tenantId;
          setActiveTenantId(resolvedTenant);
          set({
            user: { ...(res.user as any), tenant_id: resolvedTenant },
            access_token: res.access_token,
            refresh_token: (res as any)?.refresh_token || null,
            adminNeeds2FA: false,
            authErrorMessage: '',
          });
          return true;
        } catch (error: any) {
          console.error('Admin login xətası:', error.message);
          if (String(error?.message) === '2FA_REQUIRED') {
            set({ adminNeeds2FA: true, authErrorMessage: 'Bu cihaz/IP üçün 2FA tələb olunur.' });
          } else {
            set({ authErrorMessage: String(error?.message || 'Giriş xətası') });
          }
          return false;
        }
      },
      
      logout: () => {
        const { refresh_token, access_token, user } = get();
        if ((refresh_token || access_token) && user) {
          authApi.logout((refresh_token || access_token) as string, user.username);
        }
        set({ user: null, access_token: null, refresh_token: null, cart: [] });
      },
      switchTenantContext: (tenantId: string) => {
        const safeTenant = String(tenantId || '').trim() || getActiveTenantId();
        setActiveTenantId(safeTenant);
        set((state) => ({
          user: state.user
            ? {
                ...state.user,
                tenant_id: safeTenant,
              }
            : state.user,
          cart: [],
        }));
      },
      
      cart: [],
      addToCart: (item: any) => set((state) => {
        const existing = state.cart.find(c => c.id === item.id);
        if (existing) {
          return { cart: state.cart.map(c => c.id === item.id ? { ...c, qty: c.qty + 1 } : c) };
        }
        return { 
          cart: [...state.cart, { 
            id: item.id, 
            item_name: item.item_name, 
            price: item.price, 
            category: item.category, 
            is_coffee: item.is_coffee, 
            qty: 1 
          }] 
        };
      }),
      removeFromCart: (id: string) => set((state) => ({
        cart: state.cart.filter(c => c.id !== id)
      })),
      updateCartItem: (id: string, qty: number) => set((state) => ({
        cart: qty <= 0 
          ? state.cart.filter(c => c.id !== id)
          : state.cart.map(c => c.id === id ? { ...c, qty } : c)
      })),
      clearCart: () => set({ cart: [] }),

      toasts: [],
      notify: (type, message) =>
        set((state) => {
          const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          // Auto dismiss after 3.5s
          setTimeout(() => {
            get().dismissToast(id);
          }, 3500);
          return { toasts: [...state.toasts, { id, type, message }] };
        }),
      dismissToast: (id) =>
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        })),
    }),
    {
      name: hostScopedKey('emalatkhana-pos-session'),
      version: 3,
      onRehydrateStorage: () => (state) => {
        // Runtime guard for corrupted persisted lang/session payloads.
        const currentLang = state?.lang as string | undefined;
        if (!['az', 'ru', 'en'].includes(String(currentLang || ''))) {
          state?.setLang('az');
        }
        state?.setHasHydrated(true);
      },
      migrate: (persisted: any) => {
        const next = { ...(persisted || {}) };
        const allowedLang = ['az', 'ru', 'en'];
        if (!allowedLang.includes(next?.lang)) next.lang = 'az';
        if (!next?.user || typeof next.user.username !== 'string' || typeof next.user.role !== 'string') {
          next.user = null;
        }
        if (typeof next?.access_token !== 'string' || next.access_token.length < 8) {
          next.access_token = null;
        }
        if (typeof next?.refresh_token !== 'string' || next.refresh_token.length < 8) {
          next.refresh_token = null;
        }
        if (!Array.isArray(next?.cart)) next.cart = [];
        return next;
      },
      partialize: (state) => ({
        lang: state.lang,
        user: state.user,
        access_token: state.access_token,
        refresh_token: state.refresh_token,
        cart: state.cart,
      }),
    }
  )
);

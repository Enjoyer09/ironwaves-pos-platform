import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Lang } from './i18n';
import { authApi } from './api/auth';
import { setClientAuthSession } from './api/client';
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
  adminLogin: (username: string, password: string, secondFactorPin: string, riskContext?: LoginRiskContext, rememberDevice?: boolean) => Promise<boolean>;
  bootstrapPlatformOwner: (username: string, password: string) => Promise<boolean>;
  adminNeeds2FA: boolean;
  authErrorMessage: string;
  clearAuthError: () => void;
  restoreSession: () => Promise<boolean>;
  logout: () => void;
  applySessionUser: (user: UserSession | null) => void;
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
      restoreSession: async () => {
        const currentUser = get().user;
        if (!currentUser?.username) return false;
        try {
          const tenantId = String(currentUser.tenant_id || getActiveTenantId() || '').trim();
          const res = await authApi.refresh_token(undefined, tenantId);
          if (!res?.access_token) {
            throw new Error('refresh_unavailable');
          }
          const nextUser = {
            username: String((res as any)?.user?.username || currentUser.username || ''),
            role: String((res as any)?.user?.role || currentUser.role || ''),
            tenant_id: String((res as any)?.user?.tenant_id || tenantId || ''),
          };
          if (nextUser.tenant_id) {
            setActiveTenantId(nextUser.tenant_id);
          }
          set({
            user: nextUser,
            access_token: String(res.access_token || ''),
            refresh_token: null,
            adminNeeds2FA: false,
            authErrorMessage: '',
          });
          setClientAuthSession({ access_token: String(res.access_token || ''), user: nextUser });
          return true;
        } catch {
          set({ user: null, access_token: null, refresh_token: null, cart: [] });
          setClientAuthSession({ access_token: null, user: null });
          return false;
        }
      },
      
      login: async (pin: string) => {
        try {
          const tenantId = getActiveTenantId();
          const res = await authApi.pin_login(pin, tenantId);
          if (res?.user?.tenant_id) {
            setActiveTenantId(res.user.tenant_id);
          }
          const nextUser = res.user || null;
          const nextAccess = res.access_token || null;
          set({ user: nextUser, access_token: nextAccess, refresh_token: null });
          setClientAuthSession({ access_token: nextAccess, user: nextUser });
          return true;
        } catch (error: any) {
          console.error("Login xətası:", error.message);
          return false;
        }
      },

      adminLogin: async (username: string, password: string, secondFactorPin: string, riskContext?: LoginRiskContext, rememberDevice: boolean = true) => {
        try {
          const tenantId = getActiveTenantId();
          const res = await authApi.password_login(username, password, secondFactorPin, tenantId, riskContext, rememberDevice);
          const resolvedTenant = (res.user as any)?.tenant_id || tenantId;
          setActiveTenantId(resolvedTenant);
          const nextUser = { ...(res.user as any), tenant_id: resolvedTenant };
          const nextAccess = res.access_token || null;
          set({
            user: nextUser,
            access_token: nextAccess,
            refresh_token: null,
            adminNeeds2FA: false,
            authErrorMessage: '',
          });
          setClientAuthSession({ access_token: nextAccess, user: nextUser });
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
      bootstrapPlatformOwner: async (username: string, password: string) => {
        try {
          const res = await authApi.bootstrap_platform_owner(username, password);
          const resolvedTenant = (res.user as any)?.tenant_id || getActiveTenantId();
          setActiveTenantId(resolvedTenant);
          const nextUser = { ...(res.user as any), tenant_id: resolvedTenant };
          const nextAccess = res.access_token || null;
          set({
            user: nextUser,
            access_token: nextAccess,
            refresh_token: null,
            adminNeeds2FA: false,
            authErrorMessage: '',
          });
          setClientAuthSession({ access_token: nextAccess, user: nextUser });
          return true;
        } catch (error: any) {
          set({ authErrorMessage: String(error?.message || 'Owner yaradılmadı') });
          return false;
        }
      },
      
      logout: () => {
        const { user } = get();
        if (user) {
          void authApi.logout(undefined, user.username).catch((error) => {
            console.warn('Logout side-effect failed:', error);
          });
        }
        set({ user: null, access_token: null, refresh_token: null, cart: [] });
        setClientAuthSession({ access_token: null, user: null });
      },
      applySessionUser: (user) => {
        if (user?.tenant_id) {
          setActiveTenantId(user.tenant_id);
        }
        set({ user: user || null, cart: [] });
        setClientAuthSession({ access_token: get().access_token, user: user || null });
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
        const state = get();
        setClientAuthSession({ access_token: state.access_token, user: state.user });
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
      version: 4,
      onRehydrateStorage: () => (state) => {
        // Runtime guard for corrupted persisted lang/session payloads.
        const currentLang = state?.lang as string | undefined;
        if (!['az', 'ru', 'en'].includes(String(currentLang || ''))) {
          state?.setLang('az');
        }
        // Access/refresh tokens must never be rehydrated from storage.
        if (state) {
          (state as any).access_token = null;
          (state as any).refresh_token = null;
          setClientAuthSession({ access_token: null, user: (state as any).user || null });
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
        next.access_token = null;
        next.refresh_token = null;
        if (!Array.isArray(next?.cart)) next.cart = [];
        return next;
      },
      partialize: (state) => ({
        lang: state.lang,
        user: state.user,
        cart: state.cart,
      }),
    }
  )
);

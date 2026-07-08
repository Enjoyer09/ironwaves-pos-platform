/**
 * Background Fetch & Sync utility for iRonWaves Customer App.
 *
 * Uses:
 * 1. Web Background Sync API (service worker) — web fallback
 * 2. Capacitor Background Task plugin — iOS native
 *
 * Syncs wallet balance, notifications, and pending claims
 * so the user always sees fresh data when opening the app.
 */

import { Capacitor } from '@capacitor/core';
import { get_customer_app_session_live } from '../api/crm';

const BG_SYNC_KEY = 'ironwaves_bg_last_sync';
const BG_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

type BgSyncPayload = {
  cardId: string;
  token: string;
};

/**
 * Check if enough time has passed since last sync.
 */
function shouldSync(): boolean {
  try {
    const last = Number(localStorage.getItem(BG_SYNC_KEY) || '0');
    return Date.now() - last > BG_INTERVAL_MS;
  } catch {
    return true;
  }
}

function markSynced() {
  try {
    localStorage.setItem(BG_SYNC_KEY, String(Date.now()));
  } catch { /* ignore */ }
}

/**
 * Core sync function — fetches fresh session data.
 * Called both from the foreground (on app open) and background.
 */
export async function syncCustomerSession(cardId: string, token: string): Promise<any | null> {
  if (!cardId || !token) return null;
  try {
    const session = await get_customer_app_session_live(cardId, token);
    markSynced();
    return session;
  } catch (err) {
    console.warn('[BackgroundFetch] Sync failed:', err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Web Background Sync (Service Worker)
// ─────────────────────────────────────────────────────────────────────────────

export async function registerWebBackgroundSync(payload: BgSyncPayload) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    if ('sync' in registration) {
      // @ts-expect-error - SyncManager types vary by browser
      await registration.sync.register('ironwaves-customer-sync');
      console.log('[BackgroundFetch] Web Background Sync registered');
    }
  } catch (err) {
    console.warn('[BackgroundFetch] Web Background Sync registration failed:', err);
  }
}

/**
 * Handle a sync event from the service worker.
 * Call this from the service worker's `sync` event listener.
 */
export async function handleSyncEvent(payload: BgSyncPayload) {
  if (shouldSync()) {
    await syncCustomerSession(payload.cardId, payload.token);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Capacitor Background Task (iOS native)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register a Capacitor Background Task that runs periodically.
 * This requires the @capacitor/background-task plugin to be installed.
 */
export async function registerCapacitorBackgroundTask(payload: BgSyncPayload) {
  if (!Capacitor.isNativePlatform()) return;

  try {
    // Dynamic import to avoid crashes if plugin isn't installed
    const { BackgroundTask } = await import(
      /* @vite-ignore */ '@capacitor/background-task'
    ).catch(() => ({ BackgroundTask: null }));

    if (!BackgroundTask) {
      console.log('[BackgroundFetch] @capacitor/background-task not installed — skipping');
      return;
    }

    // Before going to background, schedule a task
    const taskId = BackgroundTask.beforeExit(async () => {
      if (shouldSync()) {
        await syncCustomerSession(payload.cardId, payload.token);
      }
      BackgroundTask.finish({ taskId: '' as any }); // simplified
    });

    console.log('[BackgroundFetch] Capacitor Background Task registered:', taskId);
  } catch (err) {
    console.warn('[BackgroundFetch] Capacitor Background Task failed:', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. App Open Sync — called on every app foreground
// ─────────────────────────────────────────────────────────────────────────────

export async function syncOnAppOpen(cardId: string, token: string): Promise<any | null> {
  if (!shouldSync()) return null;
  console.log('[BackgroundFetch] App opened — syncing in background');
  return syncCustomerSession(cardId, token);
}

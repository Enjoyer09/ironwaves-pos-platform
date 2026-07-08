/**
 * TypeScript client for CustomerLiveActivity Capacitor plugin.
 * Bridges the JavaScript layer to native ActivityKit Live Activities (iOS 16.1+).
 *
 * Usage:
 *   import { CustomerLiveActivity } from '../lib/live_activity';
 *   await CustomerLiveActivity.start({ customerName, starsBalance, ... });
 *   await CustomerLiveActivity.update({ starsBalance, ... });
 *   await CustomerLiveActivity.end();
 */

import { registerPlugin, Capacitor } from '@capacitor/core';

export interface LiveActivityStartOptions {
  customerName: string;
  programMode: string;
  starsBalance: number;
  progressPercent: number;
  rewardName: string;
  isCashback: boolean;
  cashbackPercent: number;
}

export interface LiveActivityUpdateOptions {
  starsBalance: number;
  progressPercent: number;
  rewardName: string;
  isCashback: boolean;
  cashbackPercent: number;
}

export interface LiveActivityPlugin {
  start(options: LiveActivityStartOptions): Promise<{ activityId: string }>;
  update(options: LiveActivityUpdateOptions): Promise<void>;
  end(): Promise<void>;
  isSupported(): Promise<{ supported: boolean }>;
}

const NativeLiveActivity = registerPlugin<LiveActivityPlugin>('CustomerLiveActivity');

/**
 * Start a Live Activity showing the customer's current wallet balance.
 * Only works on iOS 16.1+ native devices. On web/Android, this is a no-op.
 */
export async function startLiveActivity(options: LiveActivityStartOptions): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const result = await NativeLiveActivity.start(options);
    return result.activityId;
  } catch (err) {
    console.warn('[LiveActivity] Failed to start:', err);
    return null;
  }
}

/**
 * Update the active Live Activity with new balance data.
 */
export async function updateLiveActivity(options: LiveActivityUpdateOptions): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await NativeLiveActivity.update(options);
  } catch (err) {
    console.warn('[LiveActivity] Failed to update:', err);
  }
}

/**
 * End the active Live Activity.
 */
export async function endLiveActivity(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await NativeLiveActivity.end();
  } catch (err) {
    console.warn('[LiveActivity] Failed to end:', err);
  }
}

/**
 * Check if Live Activities are supported on this device (iOS 16.1+).
 */
export async function isLiveActivitySupported(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const result = await NativeLiveActivity.isSupported();
    return result.supported;
  } catch {
    return false;
  }
}

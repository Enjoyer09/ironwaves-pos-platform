/**
 * Screen Wake Lock & Kiosk Display Keep-Alive Manager
 * Prevents screens from sleeping or dimming during POS/KDS operations across all browsers & devices.
 */

let wakeLockSentinel: any = null;
let isKeepAliveEnabled = true;
let hasBoundListeners = false;
let fallbackVideoElement: HTMLVideoElement | null = null;

// Base64 tiny silent mp4 video loop (1 frame, 0.1s, transparent, silent) for legacy fallback
const SILENT_VIDEO_BASE64 =
  'data:video/mp4;base64,AAAAHGZ0eXBtcDQyAAAAAG1wNDJpc29tYXZjMQAAADpmcmVlAAABA21kYXQAAABjGAAAHAAj//+A8h42BAgMAAAAAAAB/wAAAAA=';

/**
 * Requests native Screen Wake Lock if supported by browser.
 */
async function requestNativeWakeLock(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator) || !isKeepAliveEnabled) {
    return false;
  }
  try {
    if (wakeLockSentinel && !wakeLockSentinel.released) {
      return true;
    }
    wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
    wakeLockSentinel.addEventListener('release', () => {
      wakeLockSentinel = null;
      // If still enabled and page is visible, try re-acquiring
      if (isKeepAliveEnabled && typeof document !== 'undefined' && document.visibilityState === 'visible') {
        setTimeout(() => { void requestNativeWakeLock(); }, 1000);
      }
    });
    return true;
  } catch {
    // Expected if battery saver is on or user denied permission
    return false;
  }
}

/**
 * Fallback mechanism for legacy WebKit/Safari/Android webviews
 */
function activateFallbackMediaKeepAlive(): void {
  if (typeof document === 'undefined' || !isKeepAliveEnabled) return;
  if (fallbackVideoElement) return;

  try {
    const video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    video.setAttribute('loop', '');
    video.setAttribute('aria-hidden', 'true');
    video.muted = true;
    video.volume = 0;
    video.src = SILENT_VIDEO_BASE64;
    video.style.position = 'fixed';
    video.style.bottom = '0';
    video.style.right = '0';
    video.style.width = '1px';
    video.style.height = '1px';
    video.style.opacity = '0.01';
    video.style.pointerEvents = 'none';
    video.style.zIndex = '-9999';

    document.body.appendChild(video);
    fallbackVideoElement = video;

    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        // Autoplay restrictions may delay play until first user interaction
      });
    }
  } catch {}
}

/**
 * Initializes global screen keep-alive.
 */
export function initScreenWakeLock(enabled: boolean = true): void {
  if (typeof window === 'undefined') return;
  isKeepAliveEnabled = enabled;

  if (!enabled) {
    releaseScreenWakeLock();
    return;
  }

  // 1. Try immediate native lock
  void requestNativeWakeLock().then((acquired) => {
    if (!acquired) {
      activateFallbackMediaKeepAlive();
    }
  });

  // 2. Bind re-activation event listeners once
  if (!hasBoundListeners) {
    hasBoundListeners = true;

    // Re-acquire on tab visibility return
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && isKeepAliveEnabled) {
        void requestNativeWakeLock();
        if (fallbackVideoElement && fallbackVideoElement.paused) {
          fallbackVideoElement.play().catch(() => {});
        }
      }
    });

    // Re-acquire on window focus / fullscreen toggle
    window.addEventListener('focus', () => {
      if (isKeepAliveEnabled) {
        void requestNativeWakeLock();
      }
    });

    // Acquire on first user touch/click if blocked previously by browser policy
    const userGestureHandler = () => {
      if (isKeepAliveEnabled) {
        void requestNativeWakeLock();
        if (fallbackVideoElement && fallbackVideoElement.paused) {
          fallbackVideoElement.play().catch(() => {});
        }
      }
    };

    window.addEventListener('pointerdown', userGestureHandler, { passive: true });
    window.addEventListener('touchstart', userGestureHandler, { passive: true });
    window.addEventListener('keydown', userGestureHandler, { passive: true });
  }
}

/**
 * Releases active wake lock and cleans up fallback media.
 */
export function releaseScreenWakeLock(): void {
  isKeepAliveEnabled = false;

  if (wakeLockSentinel) {
    try {
      wakeLockSentinel.release();
    } catch {}
    wakeLockSentinel = null;
  }

  if (fallbackVideoElement) {
    try {
      fallbackVideoElement.pause();
      fallbackVideoElement.src = '';
      if (fallbackVideoElement.parentNode) {
        fallbackVideoElement.parentNode.removeChild(fallbackVideoElement);
      }
    } catch {}
    fallbackVideoElement = null;
  }
}

/**
 * Returns true if wake lock or keep-alive is active.
 */
export function isScreenWakeLockActive(): boolean {
  return isKeepAliveEnabled && (Boolean(wakeLockSentinel && !wakeLockSentinel.released) || Boolean(fallbackVideoElement));
}

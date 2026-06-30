import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

export const playHapticTouch = () => {
  try {
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  } catch {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(10); } catch {}
    }
  }
};

export const playHapticHeavy = () => {
  try {
    Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});
  } catch {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(30); } catch {}
    }
  }
};

export const playHapticSuccess = () => {
  try {
    Haptics.notification({ type: NotificationType.Success }).catch(() => {});
  } catch {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate([15, 30, 15]); } catch {}
    }
  }
};

export const playHapticError = () => {
  try {
    Haptics.notification({ type: NotificationType.Error }).catch(() => {});
  } catch {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate([80, 40, 80]); } catch {}
    }
  }
};

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.emalatcoffee.loyalty',
  appName: 'Emalat Coffee',
  webDir: 'dist',
  packageClassList: [
    'CAPCameraPlugin',
    'CustomerSessionPlugin',
    'HapticsPlugin',
    'PushNotificationsPlugin',
    'CustomerLiveActivityPlugin',
  ],
  plugins: {
    CapacitorHttp: {
      enabled: true
    }
  }
};

export default config;

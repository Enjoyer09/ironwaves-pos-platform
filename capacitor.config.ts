import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ironwaves.loyalty',
  appName: 'iRonWaves Loyalty',
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

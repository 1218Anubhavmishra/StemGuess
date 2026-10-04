import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.stemguess.app',
  appName: 'Stem Guess',
  webDir: 'dist',
  server: { androidScheme: 'https' },
};

export default config;

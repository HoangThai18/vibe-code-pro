// app.config.ts
import type { ExpoConfig } from 'expo/config';

const variant = process.env.APP_VARIANT || 'production';   // development | preview | production (empty string is also production)
const suffix = variant === 'production' ? '' : `.${variant}`;

const config: ExpoConfig = {
  name: variant === 'production' ? 'Spa CRM' : `Spa CRM (${variant})`,
  slug: 'spa-crm',
  scheme: 'spacrm',
  version: '1.4.0',                                  // user-visible version
  runtimeVersion: { policy: 'fingerprint' },         // section 5
  updates: { url: 'https://u.expo.dev/<project-id>' },
  ios: { bundleIdentifier: `vn.example.spacrm${suffix}` },
  android: { package: `vn.example.spacrm${suffix}` },
  plugins: ['expo-router', 'expo-secure-store'],
  extra: { eas: { projectId: '<project-id>' } },
};

export default config;

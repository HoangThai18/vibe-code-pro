// app.config.ts
import type { ExpoConfig } from 'expo/config';

const variant = process.env.APP_VARIANT ?? 'production';   // development | preview | production
const suffix = variant === 'production' ? '' : `.${variant}`;

const config: ExpoConfig = {
  name: variant === 'production' ? 'Spa CRM' : `Spa CRM (${variant})`,
  slug: 'spa-crm',
  scheme: 'spacrm',
  version: '1.4.0',                                  // phiên bản người dùng thấy
  runtimeVersion: { policy: 'fingerprint' },         // mục 5
  updates: { url: 'https://u.expo.dev/<project-id>' },
  ios: { bundleIdentifier: `vn.example.spacrm${suffix}` },
  android: { package: `vn.example.spacrm${suffix}` },
  plugins: ['expo-router', 'expo-secure-store'],
  extra: { eas: { projectId: '<project-id>' } },
};

export default config;

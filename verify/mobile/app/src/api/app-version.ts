// src/api/app-version.ts
import * as Application from 'expo-application';
import { Platform } from 'react-native';

// Sent on every request, refresh included: builds older than the server's minimum get 426 app_update_required
export const appHeaders = (): Record<string, string> => ({
  'x-app-version': Application.nativeApplicationVersion ?? '0.0.0',
  'x-app-platform': Platform.OS,   // 'ios' | 'android'
});

let onUpdateRequired: () => void = () => {};
export const setUpdateRequiredHandler = (fn: () => void) => { onUpdateRequired = fn; };   // e.g. router.replace('/update-required')
export const notifyUpdateRequired = () => onUpdateRequired();

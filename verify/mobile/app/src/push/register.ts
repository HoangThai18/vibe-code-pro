// src/push/register.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from '../api/client';

const PUSH_TOKEN_KEY = 'push.token';

// One registration per device, not per workspace: every spa the user works in reaches it (server side below)
export async function registerForPush(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!Device.isDevice) return 'unsupported';                 // simulators get no APNs push
  if (Platform.OS === 'android') {
    // Android 13+: the channel must exist before asking for permission
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Thông báo',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return 'denied';
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const { data: pushToken } = await Notifications.getExpoPushTokenAsync({ projectId });
  await api('/v1/devices', { method: 'PUT', body: JSON.stringify({ pushToken, platform: Platform.OS }) });
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, pushToken);
  return 'granted';
}

// First logout step, while the session still works
export async function unregisterPush(): Promise<void> {
  const pushToken = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
  if (!pushToken) return;
  await api(`/v1/devices/${encodeURIComponent(pushToken)}`, { method: 'DELETE' });   // Expo tokens contain [ ]
  await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
}

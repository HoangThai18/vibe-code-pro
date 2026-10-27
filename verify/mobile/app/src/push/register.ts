// src/push/register.ts
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from '../api/client';

export async function registerForPush(tenantId: string): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!Device.isDevice) return 'unsupported';                 // simulator không nhận push từ APNs
  if (Platform.OS === 'android') {
    // Android 13+: phải có channel trước khi xin quyền
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
  await api(`/v1/t/${tenantId}/devices`, {
    method: 'PUT',
    body: JSON.stringify({ pushToken, platform: Platform.OS }),
  });
  return 'granted';
}

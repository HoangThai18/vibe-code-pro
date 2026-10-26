import AsyncStorage from '@react-native-async-storage/async-storage';

const ACCESS_KEY = 'accessToken';
const REFRESH_KEY = 'refreshToken';

export async function saveSession(tokens: { accessToken: string; refreshToken: string }) {
  await AsyncStorage.setItem(ACCESS_KEY, tokens.accessToken);
  await AsyncStorage.setItem(REFRESH_KEY, tokens.refreshToken);
}

export async function getAccessToken() {
  return AsyncStorage.getItem(ACCESS_KEY);
}

export async function getRefreshToken() {
  return AsyncStorage.getItem(REFRESH_KEY);
}

export async function signOut() {
  await AsyncStorage.removeItem(ACCESS_KEY);
  await AsyncStorage.removeItem(REFRESH_KEY);
}

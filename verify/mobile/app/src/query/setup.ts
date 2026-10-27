// src/query/setup.ts
import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { AppState, Platform, type AppStateStatus } from 'react-native';

// Có mạng lại thì query tạm dừng chạy tiếp
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => {
    setOnline(!!state.isConnected);
  }),
);

// App quay lại foreground thì làm mới dữ liệu cũ
function onAppStateChange(status: AppStateStatus) {
  if (Platform.OS !== 'web') focusManager.setFocused(status === 'active');
}
export const appStateSubscription = AppState.addEventListener('change', onAppStateChange);

// app/(app)/_layout.tsx
import { Redirect, Stack } from 'expo-router';
import { useSession } from '../../src/auth/use-session';

export default function AppLayout() {
  const { status } = useSession();          // 'loading' | 'signed-in' | 'signed-out'
  if (status === 'loading') return null;    // splash screen vẫn đang hiện
  if (status === 'signed-out') return <Redirect href="/login" />;
  return <Stack />;
}

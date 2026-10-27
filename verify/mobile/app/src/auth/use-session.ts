// ADDED (not in docs): minimal hook referenced by app/(app)/_layout.tsx
export type SessionStatus = 'loading' | 'signed-in' | 'signed-out';
export function useSession(): { status: SessionStatus } {
  return { status: 'signed-out' };
}

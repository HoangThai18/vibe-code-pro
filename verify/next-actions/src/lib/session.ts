// TEST STUB: trusts a plain cookie. A real app verifies its signed session here (the vibe-backend skill, references/auth.md)
import { cookies } from 'next/headers';

export async function getSessionUserId(): Promise<string | null> {
  return (await cookies()).get('uid')?.value ?? null;
}

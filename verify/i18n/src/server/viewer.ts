// Demo stand-in for the project's auth + tenant layer (the real one reads the session and the tenant from the URL)
import { cookies } from 'next/headers';

export async function getViewer() {
  const userLocale = (await cookies()).get('demo_user_locale')?.value ?? null;
  return { userLocale, tenantLocale: 'vi', timeZone: 'Asia/Ho_Chi_Minh' };
}
